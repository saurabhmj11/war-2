// POST /api/legallens/impact
// For a given risk flag in a document, returns:
//   - fairVersionExample: what a balanced version of that clause typically looks like (educational, not drafting)
//   - breachScenario: a concrete scenario where this clause bites
//   - estimatedExposure: rough financial exposure range if breached
//   - riskLevel: low/medium/high/critical
// Lazy-loaded per-flag to keep initial analysis fast. Cached per (documentId + sourceClause).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SYSTEM_PROMPT_V1_1 } from "@/lib/legallens/system-prompt";
import { detectAdvice } from "@/lib/legallens/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface ImpactAnalysis {
  flagKey: string; // `${sourceClause}-${sourcePage}` for caching
  fairVersionExample: string; // what a balanced version typically looks like
  fairVersionRationale: string; // 1-sentence why this is more balanced
  breachScenario: string; // concrete scenario where this clause bites
  estimatedExposure: {
    low: string; // "$0 - $500"
    high: string; // "$5K - $50K"
    description: string; // 1-sentence context
  };
  riskLevel: "low" | "medium" | "high" | "critical";
  mitigationOptions: string[]; // 2-3 things the user could negotiate (informational, not directives)
}

const IMPACT_PROMPT = `You are analyzing a single risk flag in a legal document. For this flag, produce an impact analysis that helps the user understand (a) what a more balanced version of this clause typically looks like in market-standard documents, (b) a concrete scenario where this clause could bite them, and (c) an estimated financial exposure range if breached.

You MUST respond with strict JSON matching this TypeScript interface — no preamble, no markdown fences:

interface ImpactAnalysis {
  fairVersionExample: string; // <= 2 sentences, plain language. What a balanced version of this clause typically looks like in market-standard documents. Educational, NOT drafting.
  fairVersionRationale: string; // 1 sentence, why this is more balanced than the user's version
  breachScenario: string; // 1-2 sentences, concrete scenario where this clause bites
  estimatedExposure: {
    low: string; // e.g. "$0 - $500" — best case
    high: string; // e.g. "$5K - $50K" — worst case
    description: string; // 1 sentence of context
  };
  riskLevel: "low" | "medium" | "high" | "critical";
  mitigationOptions: string[]; // 2-3 things the user could ASK THE OTHER PARTY to change (informational). Never directives.
}

RULES:
- fairVersionExample is INFORMATIONAL — it teaches what a balanced clause looks like, not what the user should write. Use language like "A balanced version of this clause typically..." NEVER "you should write" or "I recommend."
- estimatedExposure is a rough range based on typical disputes for this clause type. If you don't have good data, give a wide range and acknowledge the uncertainty in the "description" field.
- mitigationOptions are things to ASK the counterparty (questions, not demands). E.g., "Ask if the liability cap can be raised to 12 months of fees."
- Never use directive language ("you should", "do not sign", "I recommend").
- If the flag is "note" severity (standard/favorable), the impact analysis can be brief — fairVersionExample can note that the clause is already balanced, breachScenario can describe the rare edge case, exposure can be low.

Document text (truncated to 20,000 chars for context):
`;

async function callLlmForImpact(
  documentText: string,
  flag: { severity: string; category: string; plainSummary: string; sourceClause: string; sourcePage: number; plainTranslation: string }
): Promise<ImpactAnalysis> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();

  const userPrompt = `${IMPACT_PROMPT}\n---\n${documentText.slice(0, 20000)}\n---\n\nRISK FLAG TO ANALYZE:
- severity: ${flag.severity}
- category: ${flag.category}
- plainSummary: ${flag.plainSummary}
- sourceClause: ${flag.sourceClause}
- sourcePage: ${flag.sourcePage}
- plainTranslation: ${flag.plainTranslation}

Respond with strict JSON only.`;

  const completion = await zai.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT_V1_1 + "\n\nFor impact analysis: NEVER tell the user what to do. Show what balanced clauses look like (educational), describe scenarios, give ranges. The user decides." },
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

  let parsed: ImpactAnalysis;
  try {
    parsed = JSON.parse(jsonStr) as ImpactAnalysis;
    parsed.flagKey = `${flag.sourceClause}-${flag.sourcePage}`;
  } catch (parseErr) {
    console.error("[impact] JSON parse error:", parseErr, "raw:", jsonStr.slice(0, 500));
    throw new Error("LLM did not return valid JSON. Please retry.");
  }

  // R1 enforcement on mitigationOptions + fairVersionExample
  const adviceScan = detectAdvice(
    parsed.fairVersionExample + " " + parsed.fairVersionRationale + " " + (parsed.mitigationOptions || []).join(" ")
  );
  if (adviceScan.isAdvice) {
    // Neutralize
    parsed.fairVersionExample = parsed.fairVersionExample
      .replace(/\byou should\b/gi, "a balanced approach")
      .replace(/\bI recommend\b/gi, "one option is")
      .replace(/\bdo not (?:sign|accept)\b/gi, "consider not signing");
    parsed.mitigationOptions = (parsed.mitigationOptions || []).map((opt) =>
      opt
        .replace(/\byou should\b/gi, "ask whether")
        .replace(/\bI recommend\b/gi, "one option is")
    );
  }

  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      documentId: string;
      flag: {
        severity: string;
        category: string;
        plainSummary: string;
        sourceClause: string;
        sourcePage: number;
        plainTranslation: string;
      };
    };
    if (!body.documentId || !body.flag || !body.flag.sourceClause) {
      return NextResponse.json({ error: "Missing documentId or flag" }, { status: 400 });
    }

    const doc = await db.document.findUnique({ where: { id: body.documentId } });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (doc.expiresAt < new Date()) return NextResponse.json({ error: "Document has expired" }, { status: 410 });

    const result = await callLlmForImpact(doc.fullText, body.flag);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[impact] error:", message);
    return NextResponse.json({ error: `Impact analysis failed: ${message}` }, { status: 500 });
  }
}
