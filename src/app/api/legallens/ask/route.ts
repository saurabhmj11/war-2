// POST /api/legallens/ask
// Grounded Q&A — answers a user question about a document with citations.
// Uses R6 (injection defense) and R1 (advice detector) as post-generation guardrails.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SYSTEM_PROMPT_V1_1, DISCLAIMER_TEXT, escalationCardText } from "@/lib/legallens/system-prompt";
import { detectAdvice, detectEscalation } from "@/lib/legallens/safety";
import type { QaResult } from "@/lib/legallens/types";
import { LEGAL_AID_REFERRALS } from "@/lib/legallens/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const QA_USER_PROMPT_TEMPLATE = `A user uploaded a legal document and asked a question. Answer the question using ONLY information from the document. You MUST respond with strict JSON matching this TypeScript interface — no preamble, no markdown fences, no commentary:

interface QaResult {
  answer: string; // your plain-language answer, <= 4 sentences, Flesch-Kincaid <= 8.0
  citations: Array<{ chip: string; page: number; bbox: [number, number, number, number]; quote: string }>;
  inDocument: boolean; // true if the answer is grounded in the document
  abstentionReason?: string; // only if inDocument is false — e.g. "no_chunk_found"
  considerations: string[]; // 0-3 considerations if the user asked "should I sign?" — never directives
  escalationTriggered: boolean;
  adviceDetectorPassed: boolean; // self-check — must be true
}

RULES:
- If the document does not contain the answer, set inDocument=false and abstentionReason="no_chunk_found" — do NOT use general legal knowledge.
- If the user asked "should I sign?" or similar — set considerations to 1-3 factors the user might weigh (with citations). NEVER include a directive ("you should", "do not sign").
- Every citation must include a real page number from the document. bbox is [x, y, width, height] in PDF user space from top-left.
- If the question or document touches eviction, foreclosure, immigration, criminal, custody, being sued, deadlines, or fraud — set escalationTriggered=true.
- Self-check your answer for advice-directive language before returning. If found, regenerate. Set adviceDetectorPassed=true only if your answer contains no directive language.

User question: {question}

Document text (truncated to first 25,000 chars):`;

async function callLlmForQa(question: string, documentText: string): Promise<QaResult> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();

  const userPrompt = QA_USER_PROMPT_TEMPLATE
    .replace("{question}", question)
    .concat("\n\n---\n")
    .concat(documentText.slice(0, 25000))
    .concat("\n---\n\nRespond with strict JSON only.");

  const completion = await zai.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT_V1_1 },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 1500,
  });

  const rawContent = completion.choices[0]?.message?.content || "";
  const jsonStr = rawContent
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: QaResult;
  try {
    parsed = JSON.parse(jsonStr) as QaResult;
  } catch (parseErr) {
    console.error("[ask] JSON parse error:", parseErr, "raw:", jsonStr.slice(0, 500));
    throw new Error("LLM did not return valid JSON. Please rephrase your question.");
  }

  // Post-LLM R1 enforcement: re-run advice detector on the actual answer text
  const adviceCheck = detectAdvice(parsed.answer + " " + parsed.considerations.join(" "));
  parsed.adviceDetectorPassed = !adviceCheck.isAdvice;
  if (adviceCheck.isAdvice) {
    // Block the directive; replace with a neutral considerations-style message
    parsed.answer =
      "I can't tell you what to do — that's your call. Here are the things in this document worth weighing.";
    parsed.considerations = parsed.considerations.length > 0
      ? parsed.considerations
      : ["Review the summary and risk flags above, and consult an attorney if anything is unclear."];
    parsed.adviceDetectorPassed = true; // now passes
  }

  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { documentId: string; question: string };
    if (!body.documentId || !body.question) {
      return NextResponse.json({ error: "Missing documentId or question" }, { status: 400 });
    }
    if (body.question.length > 1000) {
      return NextResponse.json({ error: "Question too long (max 1000 chars)" }, { status: 400 });
    }

    const doc = await db.document.findUnique({ where: { id: body.documentId } });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.expiresAt < new Date()) {
      return NextResponse.json({ error: "Document has expired" }, { status: 410 });
    }

    // R5: escalation trigger on the question itself (e.g. user mentions eviction)
    const questionEscalation = detectEscalation(body.question);
    const docEscalation = detectEscalation(doc.fullText);
    const escalationTriggered = questionEscalation.triggered || docEscalation.triggered;
    const escalationCategory = questionEscalation.category || docEscalation.category;

    const qa = await callLlmForQa(body.question, doc.fullText);
    qa.escalationTriggered = escalationTriggered;

    // Persist chat message
    await db.chatMessage.create({
      data: {
        documentId: doc.id,
        role: "user",
        content: body.question,
      },
    });
    await db.chatMessage.create({
      data: {
        documentId: doc.id,
        role: "assistant",
        content: qa.answer,
        citationsJson: JSON.stringify(qa.citations),
      },
    });

    if (escalationTriggered) {
      return NextResponse.json({
        ...qa,
        escalation: {
          triggered: true,
          category: escalationCategory,
          cardText: escalationCardText(escalationCategory || ""),
          referralLinks: LEGAL_AID_REFERRALS.map((r) => ({ label: r.label, url: r.url })),
        },
        disclaimer: DISCLAIMER_TEXT,
      });
    }

    return NextResponse.json({ ...qa, disclaimer: DISCLAIMER_TEXT });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ask] error:", message);
    return NextResponse.json({ error: `Q&A failed: ${message}` }, { status: 500 });
  }
}
