// POST /api/legallens/analyze
// Fetches document text, runs injection filter + escalation detector on raw text,
// then calls the LLM with System Prompt v1.1 to produce AnalysisResult JSON.
// Stores Analysis row in Prisma.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SYSTEM_PROMPT_V1_1, DISCLAIMER_TEXT, escalationCardText } from "@/lib/legallens/system-prompt";
import { detectInjection, detectEscalation, fleschKincaidGrade } from "@/lib/legallens/safety";
import { computeTrustScore, buildPreSigningChecklist } from "@/lib/legallens/trust";
import type { AnalysisResult } from "@/lib/legallens/types";
import { LEGAL_AID_REFERRALS } from "@/lib/legallens/types";

export const runtime = "nodejs";
export const maxDuration = 120; // LLM call can take a while

export type ReadingLevel = "simpler" | "standard";
export type OutputLanguage = "en" | "es";

const LEVEL_TARGETS: Record<ReadingLevel, { fkMax: number; guidance: string }> = {
  simpler: {
    fkMax: 6.0,
    guidance: "Aim for Flesch-Kincaid grade level <= 6.0. Use shorter sentences (<=15 words), simpler vocabulary, and concrete examples. The reader may have limited English proficiency. Define every legal term on first use.",
  },
  standard: {
    fkMax: 8.0,
    guidance: "Aim for Flesch-Kincaid grade level <= 8.0. Sentences <= 25 words. Translate Latinate terms on first use.",
  },
};

const LANGUAGE_GUIDANCE: Record<OutputLanguage, { output: string; guidance: string }> = {
  en: {
    output: "English",
    guidance: "Write all output in English.",
  },
  es: {
    output: "Spanish",
    guidance: "Write all output in Spanish (español). Use plain, neutral Spanish understood across Latin America and Spain. Keep citation chips in the format [Cláusula X.Y · p.N]. Keep severity labels in Spanish: \"Cláusula de alto impacto\" (high), \"Vale la pena entender\" (medium), \"Estándar o favorable\" (note). Keep category names in English for cross-language consistency.",
  },
};

const ANALYSIS_USER_PROMPT = `Analyze the following legal document and produce a plain-language analysis. You MUST respond with strict JSON matching this TypeScript interface — no preamble, no markdown fences, no commentary:

interface AnalysisResult {
  documentType: "residential_lease" | "nda" | "offer_severance" | "debt_collection" | "other";
  documentTitlePlain: string; // <= 8 words
  topCardIntro: string; // "This is a {documentTitlePlain}. Here's the deal in plain terms:" (or Spanish equivalent)
  summaryBullets: Array<{ text: string; citation: string }>; // 5-7 bullets, each with a citation chip
  flags: Array<{
    severity: "high" | "medium" | "note";
    severityLabel: "High-impact clause" | "Worth understanding" | "Standard or favorable" | "Cláusula de alto impacto" | "Vale la pena entender" | "Estándar o favorable";
    category: string;
    plainSummary: string;
    sourceClause: string;
    sourcePage: number;
    sourceBbox: [number, number, number, number]; // [x, y, width, height] in PDF user space
    plainTranslation: string;
    questionsToAsk: string[];
  }>;
  jargon: Array<{ term: string; plainDefinition: string; sourceClause: string; sourcePage: number }>;
  fleschKincaidGrade: number; // your self-estimate of the summary's FK grade
}

RULES:
- Every summary bullet AND every flag MUST include a citation with a real page number from the document.
- Never use directive language ("you should", "do not sign", "I recommend").
- Translate Latinate terms ("notwithstanding the foregoing" → "despite what was said above").
- Severity is never color-alone — always pair with the text label.
- bbox coordinates are in PDF user space (top-left origin; use [x, y, width, height] from the top-left of the page).
- If you cannot find the page number, use page 1. Do not fabricate.

Document text (truncated to first 30,000 chars to fit context window):`;

/**
 * Calls the AI Model to perform a comprehensive analysis of the legal document.
 * 
 * @param documentText - The raw extracted text of the legal document.
 * @param level - The target reading level ("simpler" or "standard").
 * @param language - The target output language ("en" or "es").
 * @returns A promise that resolves to the structured `AnalysisResult`.
 */
async function callLlmForAnalysis(
  documentText: string,
  level: ReadingLevel = "standard",
  language: OutputLanguage = "en"
): Promise<AnalysisResult> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();

  const truncatedText = documentText.slice(0, 30000);
  const levelCfg = LEVEL_TARGETS[level];
  const langCfg = LANGUAGE_GUIDANCE[language];

  const userPrompt = `${ANALYSIS_USER_PROMPT}\n\nADDITIONAL CONSTRAINTS:\n- ${levelCfg.guidance}\n- ${langCfg.guidance}\n\n---\n${truncatedText}\n---\n\nRespond with strict JSON only.`;

  const completion = await zai.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT_V1_1 },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4000,
  });

  const rawContent = completion.choices[0]?.message?.content || "";
  // Strip markdown fences if the model added them despite instructions
  const jsonStr = rawContent
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: AnalysisResult;
  try {
    parsed = JSON.parse(jsonStr) as AnalysisResult;
  } catch (parseErr) {
    console.error("[analyze] JSON parse error:", parseErr, "raw:", jsonStr.slice(0, 500));
    throw new Error("LLM did not return valid JSON. Please retry.");
  }

  // Self-check: compute FK on summary bullets + flag summaries combined
  const summaryText = parsed.summaryBullets.map((b) => b.text).join(". ");
  const fk = fleschKincaidGrade(summaryText);
  parsed.fleschKincaidGrade = fk;

  // Self-check: ensure severityLabel is paired with severity (override for Spanish if applicable)
  for (const flag of parsed.flags) {
    if (language === "es") {
      if (flag.severity === "high") flag.severityLabel = "Cl\u00e1usula de alto impacto";
      if (flag.severity === "medium") flag.severityLabel = "Vale la pena entender";
      if (flag.severity === "note") flag.severityLabel = "Est\u00e1ndar o favorable";
    } else {
      if (flag.severity === "high") flag.severityLabel = "High-impact clause";
      if (flag.severity === "medium") flag.severityLabel = "Worth understanding";
      if (flag.severity === "note") flag.severityLabel = "Standard or favorable";
    }
  }

  // Self-check: ensure disclaimer is set
  parsed.disclaimer = DISCLAIMER_TEXT;

  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      documentId: string;
      level?: ReadingLevel;
      language?: OutputLanguage;
    };
    if (!body.documentId) {
      return NextResponse.json({ error: "Missing documentId" }, { status: 400 });
    }

    const level: ReadingLevel = body.level === "simpler" ? "simpler" : "standard";
    const language: OutputLanguage = body.language === "es" ? "es" : "en";

    const doc = await db.document.findUnique({ where: { id: body.documentId } });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.expiresAt < new Date()) {
      return NextResponse.json({ error: "Document has expired (24h limit)" }, { status: 410 });
    }

    // Pre-LLM guardrails
    const injectionCheck = detectInjection(doc.fullText);
    const escalationCheck = detectEscalation(doc.fullText);

    // Call LLM for analysis
    const analysis = await callLlmForAnalysis(doc.fullText, level, language);

    // Post-LLM: merge escalation
    analysis.escalation = {
      triggered: escalationCheck.triggered,
      category: escalationCheck.category,
      cardText: escalationCheck.triggered
        ? escalationCardText(escalationCheck.category || "")
        : undefined,
      referralLinks: escalationCheck.triggered
        ? LEGAL_AID_REFERRALS.map((r) => ({ label: r.label, url: r.url }))
        : undefined,
    };

    // Compute trust score (deterministic, no LLM call)
    analysis.trustScore = computeTrustScore(analysis);

    // Build pre-signing checklist from flags + escalation
    analysis.preSigningChecklist = buildPreSigningChecklist(analysis);

    // Persist analysis
    await db.analysis.create({
      data: {
        documentId: doc.id,
        summaryJson: JSON.stringify({
          documentType: analysis.documentType,
          documentTitlePlain: analysis.documentTitlePlain,
          topCardIntro: analysis.topCardIntro,
          summaryBullets: analysis.summaryBullets,
          trustScore: analysis.trustScore,
          preSigningChecklist: analysis.preSigningChecklist,
        }),
        flagsJson: JSON.stringify(analysis.flags),
        jargonJson: JSON.stringify(analysis.jargon),
      },
    });

    if (injectionCheck.isInjection) {
      // Log but do not block — the system prompt R6 is the primary defense
      console.warn(`[analyze] Injection patterns detected in document ${doc.id}:`, injectionCheck.matchedPatterns);
    }

    return NextResponse.json(analysis);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[analyze] error:", message);
    return NextResponse.json({ error: `Analysis failed: ${message}` }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Fetch latest analysis for a document
  try {
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get("documentId");
    if (!documentId) {
      return NextResponse.json({ error: "Missing documentId" }, { status: 400 });
    }
    const analysis = await db.analysis.findFirst({
      where: { documentId },
      orderBy: { createdAt: "desc" },
    });
    if (!analysis) {
      return NextResponse.json({ error: "No analysis found" }, { status: 404 });
    }
    const summary = JSON.parse(analysis.summaryJson);
    const flags = JSON.parse(analysis.flagsJson);
    const jargon = JSON.parse(analysis.jargonJson);
    // Backward compat: re-compute trust score + checklist + FK grade if not persisted (older analyses)
    const result = {
      ...summary,
      flags,
      jargon,
      disclaimer: DISCLAIMER_TEXT,
    } as AnalysisResult;
    if (!result.trustScore) result.trustScore = computeTrustScore(result);
    if (!result.preSigningChecklist) result.preSigningChecklist = buildPreSigningChecklist(result);
    if (typeof result.fleschKincaidGrade !== "number" || result.fleschKincaidGrade === 0) {
      const summaryText = (result.summaryBullets || []).map((b) => b.text).join(". ");
      result.fleschKincaidGrade = fleschKincaidGrade(summaryText);
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
