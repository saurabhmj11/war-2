// POST /api/legallens/compare
// Takes two document IDs, fetches both documents, calls LLM with a compare-specific
// system prompt to produce a topic-anchored diff covering the 6 critical categories
// (payment, liability, termination, IP, renewal, law-minimums) plus a missing-clause check.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SYSTEM_PROMPT_V1_1, DISCLAIMER_TEXT } from "@/lib/legallens/system-prompt";
import { detectAdvice, detectEscalation } from "@/lib/legallens/safety";

export const runtime = "nodejs";
export const maxDuration = 120;

export interface CompareRow {
  topic: string;
  v1Summary: string;
  v2Summary: string;
  favor: "v1" | "v2" | "neutral";
  favorRationale: string;
  v1Citation: string;
  v2Citation: string;
  diffType: "changed" | "added_in_v2" | "removed_in_v2" | "unchanged";
}

export interface CompareResult {
  documentV1: { id: string; fileName: string; documentTitlePlain: string };
  documentV2: { id: string; fileName: string; documentTitlePlain: string };
  rows: CompareRow[];
  missingClauseCheck: {
    protectionsPresentInBoth: string[];
    protectionsMissingInV1: string[];
    protectionsMissingInV2: string[];
  };
  overallFavor: "v1" | "v2" | "neutral";
  overallRationale: string;
  disclaimer: string;
}

const COMPARE_USER_PROMPT = `Compare two versions of a legal document. Produce a topic-anchored diff covering the 6 critical categories from CUAD/Contract review: payment, liability, termination, IP, renewal, law_minimums (notice periods, governing law, dispute resolution). You MUST respond with strict JSON matching this TypeScript interface — no preamble, no markdown fences, no commentary:

interface CompareResult {
  rows: Array<{
    topic: "payment" | "liability" | "termination" | "ip" | "renewal" | "law_minimums";
    v1Summary: string;
    v2Summary: string;
    favor: "v1" | "v2" | "neutral";
    favorRationale: string;
    v1Citation: string;
    v2Citation: string;
    diffType: "changed" | "added_in_v2" | "removed_in_v2" | "unchanged";
  }>;
  missingClauseCheck: {
    protectionsPresentInBoth: string[];
    protectionsMissingInV1: string[];
    protectionsMissingInV2: string[];
  };
  overallFavor: "v1" | "v2" | "neutral";
  overallRationale: string;
}

RULES:
- Every row MUST include real page numbers for citations. If a topic is not addressed in a version, use "[Not in document]".
- Never use directive language ("you should accept v2", "I recommend v1"). Use neutral favor language ("v1 is more tenant-favorable because...").
- For each topic, write the summary at Flesch-Kincaid <= 8.0 — one sentence only.
- The 6 rows MUST cover all 6 topics — produce exactly 6 rows.
- diffType: "added_in_v2" if v1 says "Not addressed" and v2 has a clause; "removed_in_v2" if v1 has a clause and v2 says "Not addressed"; "unchanged" if both summaries are substantively identical; "changed" otherwise.
- For missingClauseCheck, focus on protective clauses (caps on liability, mutual confidentiality, ROFR, audit rights, cure periods, IP carve-outs) — not every clause.

Document V1 ({v1FileName}):
{v1Text}

---

Document V2 ({v2FileName}):
{v2Text}

---

Respond with strict JSON only.`;

async function callLlmForCompare(
  v1: { id: string; fileName: string; fullText: string },
  v2: { id: string; fileName: string; fullText: string }
): Promise<CompareResult> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();

  const userPrompt = COMPARE_USER_PROMPT
    .replace("{v1FileName}", v1.fileName)
    .replace("{v1Text}", v1.fullText.slice(0, 15000))
    .replace("{v2FileName}", v2.fileName)
    .replace("{v2Text}", v2.fullText.slice(0, 15000));

  const completion = await zai.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT_V1_1 + "\n\nFor compare mode: never tell the user which version to accept. State which version is more favorable and why — that is information, not advice." },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 3500,
  });

  const rawContent = completion.choices[0]?.message?.content || "";
  const jsonStr = rawContent
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: CompareResult;
  try {
    parsed = JSON.parse(jsonStr) as CompareResult;
  } catch (parseErr) {
    console.error("[compare] JSON parse error:", parseErr, "raw:", jsonStr.slice(0, 500));
    throw new Error("LLM did not return valid JSON. Please retry.");
  }

  // Post-LLM R1 enforcement: scan every row's favorRationale + overallRationale for advice
  const adviceScan = detectAdvice(
    parsed.rows.map((r) => r.favorRationale).join(" ") + " " + parsed.overallRationale
  );
  if (adviceScan.isAdvice) {
    parsed.overallRationale = parsed.overallRationale
      .replace(/\byou should\b/gi, "the user might consider")
      .replace(/\byou must\b/gi, "the user might consider")
      .replace(/\bI recommend\b/gi, "one option is")
      .replace(/\bdo not (?:sign|accept)\b/gi, "consider not signing");
    for (const row of parsed.rows) {
      row.favorRationale = row.favorRationale
        .replace(/\byou should\b/gi, "the user might consider")
        .replace(/\bI recommend\b/gi, "one option is");
    }
  }

  parsed.disclaimer = DISCLAIMER_TEXT;
  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { v1Id: string; v2Id: string };
    if (!body.v1Id || !body.v2Id) {
      return NextResponse.json({ error: "Missing v1Id or v2Id" }, { status: 400 });
    }
    if (body.v1Id === body.v2Id) {
      return NextResponse.json({ error: "Cannot compare a document to itself" }, { status: 400 });
    }

    const [v1, v2] = await Promise.all([
      db.document.findUnique({ where: { id: body.v1Id } }),
      db.document.findUnique({ where: { id: body.v2Id } }),
    ]);
    if (!v1) return NextResponse.json({ error: "V1 not found" }, { status: 404 });
    if (!v2) return NextResponse.json({ error: "V2 not found" }, { status: 404 });
    if (v1.expiresAt < new Date()) return NextResponse.json({ error: "V1 has expired" }, { status: 410 });
    if (v2.expiresAt < new Date()) return NextResponse.json({ error: "V2 has expired" }, { status: 410 });

    const result = await callLlmForCompare(
      { id: v1.id, fileName: v1.fileName, fullText: v1.fullText },
      { id: v2.id, fileName: v2.fileName, fullText: v2.fullText }
    );

    result.documentV1 = {
      id: v1.id,
      fileName: v1.fileName,
      documentTitlePlain: result.documentV1?.documentTitlePlain || v1.fileName,
    };
    result.documentV2 = {
      id: v2.id,
      fileName: v2.fileName,
      documentTitlePlain: result.documentV2?.documentTitlePlain || v2.fileName,
    };

    // R5: log escalation triggers (no card surfaced in compare mode, but worth tracking)
    const v1Esc = detectEscalation(v1.fullText);
    const v2Esc = detectEscalation(v2.fullText);
    if (v1Esc.triggered || v2Esc.triggered) {
      console.warn("[compare] Escalation detected:", v1Esc.category, v2Esc.category);
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[compare] error:", message);
    return NextResponse.json({ error: `Compare failed: ${message}` }, { status: 500 });
  }
}
