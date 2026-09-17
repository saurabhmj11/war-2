// POST /api/legallens/multi-ask
// Cross-document grounded Q&A: ask one question across all of a user's uploaded docs,
// get answers citing whichever docs contain relevant clauses.
// Designed for legal-aid paralegals (Priya persona: 40 client docs/week).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SYSTEM_PROMPT_V1_1, DISCLAIMER_TEXT, escalationCardText } from "@/lib/legallens/system-prompt";
import { detectAdvice, detectEscalation } from "@/lib/legallens/safety";
import type { QaResult, Citation } from "@/lib/legallens/types";
import { LEGAL_AID_REFERRALS } from "@/lib/legallens/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface MultiAskResult {
  answer: string;
  citations: Array<Citation & { documentId: string; documentFileName: string }>;
  inDocument: boolean;
  abstentionReason?: string;
  considerations: string[];
  escalationTriggered: boolean;
  adviceDetectorPassed: boolean;
  perDocCoverage: Array<{ documentId: string; documentFileName: string; cited: boolean }>;
  disclaimer: string;
}

const MULTI_ASK_PROMPT = `A user has uploaded multiple legal documents and asked one question. Answer using ONLY information from the documents provided. You MUST respond with strict JSON matching this TypeScript interface — no preamble, no markdown fences:

interface MultiAskResult {
  answer: string; // <= 5 sentences, plain language, FK <= 8.0
  citations: Array<{
    chip: string; // "[Clause X · p.N, doc:N]"
    documentIndex: number; // 0-based index into the documents array
    page: number;
    bbox: [number, number, number, number];
    quote: string;
  }>;
  inDocument: boolean; // true if at least one document contains relevant content
  abstentionReason?: string; // only if inDocument is false
  considerations: string[]; // 0-3 considerations if user asked "should I sign X?"
  escalationTriggered: boolean;
  adviceDetectorPassed: boolean;
}

RULES:
- Cite the document index (0, 1, 2...) AND page number for every claim.
- If multiple documents contribute to the answer, include a citation from each.
- If NO document contains the answer, set inDocument=false and abstentionReason="no_chunk_found".
- Never use directive language ("you should", "I recommend").
- Per-doc coverage: explicitly state which documents contributed.

Documents provided below. Document index in [brackets] is the documentIndex to use in citations.`;

async function callLlmForMultiAsk(
  question: string,
  docs: Array<{ id: string; fileName: string; fullText: string }>
): Promise<MultiAskResult> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();

  const docBlocks = docs
    .map((d, i) => `[Document ${i}: ${d.fileName}]\n${d.fullText.slice(0, 12000)}`)
    .join("\n\n---\n\n");

  const userPrompt = `${MULTI_ASK_PROMPT}\n\nUser question: ${question}\n\n${docBlocks}\n\nRespond with strict JSON only.`;

  const completion = await zai.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT_V1_1 + "\n\nFor multi-document mode: cite which document (by index) and page each claim comes from. If no document addresses the question, abstain." },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 2500,
  });

  const rawContent = completion.choices[0]?.message?.content || "";
  const jsonStr = rawContent
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: MultiAskResult;
  try {
    const raw = JSON.parse(jsonStr);
    // Map documentIndex → real documentId + fileName
    const citations = (raw.citations || []).map((c: { documentIndex: number; chip: string; page: number; bbox: [number, number, number, number]; quote: string }) => {
      const doc = docs[c.documentIndex] || docs[0];
      return {
        chip: c.chip,
        documentId: doc.id,
        documentFileName: doc.fileName,
        page: c.page,
        bbox: c.bbox,
        quote: c.quote,
      };
    });
    parsed = {
      answer: raw.answer || "",
      citations,
      inDocument: raw.inDocument || false,
      abstentionReason: raw.abstentionReason,
      considerations: raw.considerations || [],
      escalationTriggered: raw.escalationTriggered || false,
      adviceDetectorPassed: raw.adviceDetectorPassed || true,
      perDocCoverage: docs.map((d, i) => ({
        documentId: d.id,
        documentFileName: d.fileName,
        cited: citations.some((c: { documentId: string }) => c.documentId === d.id) || raw.citations?.some((cc: { documentIndex: number }) => cc.documentIndex === i),
      })),
      disclaimer: DISCLAIMER_TEXT,
    };
  } catch (parseErr) {
    console.error("[multi-ask] JSON parse error:", parseErr, "raw:", jsonStr.slice(0, 500));
    throw new Error("LLM did not return valid JSON. Please rephrase your question.");
  }

  // R1 enforcement
  const adviceCheck = detectAdvice(parsed.answer + " " + parsed.considerations.join(" "));
  parsed.adviceDetectorPassed = !adviceCheck.isAdvice;
  if (adviceCheck.isAdvice) {
    parsed.answer = "I can't tell you what to do — that's your call. Here are the things across your documents worth weighing.";
    parsed.considerations = parsed.considerations.length > 0
      ? parsed.considerations
      : ["Review the summaries and risk flags in each document, and consult an attorney if anything is unclear."];
    parsed.adviceDetectorPassed = true;
  }

  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { question: string; documentIds: string[] };
    if (!body.question || !body.documentIds || body.documentIds.length === 0) {
      return NextResponse.json({ error: "Missing question or documentIds" }, { status: 400 });
    }
    if (body.question.length > 1000) {
      return NextResponse.json({ error: "Question too long (max 1000 chars)" }, { status: 400 });
    }
    if (body.documentIds.length > 10) {
      return NextResponse.json({ error: "Too many documents (max 10 per multi-ask)" }, { status: 400 });
    }

    const docs = await Promise.all(
      body.documentIds.map((id) => db.document.findUnique({ where: { id } }))
    );
    const validDocs = docs.filter((d): d is NonNullable<typeof d> => d !== null);
    if (validDocs.length === 0) {
      return NextResponse.json({ error: "No valid documents found (they may have expired)" }, { status: 404 });
    }

    // R5: scan question + each doc text for escalation triggers
    const questionEsc = detectEscalation(body.question);
    const docEscs = validDocs.map((d) => detectEscalation(d.fullText));
    const anyEsc = questionEsc.triggered || docEscs.some((e) => e.triggered);

    const result = await callLlmForMultiAsk(
      body.question,
      validDocs.map((d) => ({ id: d.id, fileName: d.fileName, fullText: d.fullText }))
    );
    result.escalationTriggered = anyEsc;

    // Persist chat message to the FIRST document's history (arbitrary but useful for audit trail)
    if (validDocs[0]) {
      await db.chatMessage.create({
        data: {
          documentId: validDocs[0].id,
          role: "user",
          content: `[Multi-ask across ${validDocs.length} docs] ${body.question}`,
        },
      });
      await db.chatMessage.create({
        data: {
          documentId: validDocs[0].id,
          role: "assistant",
          content: result.answer,
          citationsJson: JSON.stringify(result.citations),
        },
      });
    }

    if (anyEsc) {
      const category = questionEsc.category || docEscs.find((e) => e.triggered)?.category;
      return NextResponse.json({
        ...result,
        escalation: {
          triggered: true,
          category,
          cardText: escalationCardText(category || ""),
          referralLinks: LEGAL_AID_REFERRALS.map((r) => ({ label: r.label, url: r.url })),
        },
      });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[multi-ask] error:", message);
    return NextResponse.json({ error: `Multi-ask failed: ${message}` }, { status: 500 });
  }
}
