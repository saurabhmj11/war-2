// Trust score + pre-signing checklist generator
// Derived from analysis results — no LLM call needed (deterministic).

import type { AnalysisResult, RiskFlag, TrustScore, PreSigningChecklist } from "./types";

const ESCALATION_CATEGORY_LABELS: Record<string, string> = {
  eviction: "Eviction proceeding detected",
  foreclosure: "Foreclosure proceeding detected",
  immigration: "Immigration matter detected",
  criminal: "Criminal matter detected",
  custody_divorce: "Family court matter detected",
  being_sued: "You are being sued",
  response_deadline: "Response deadline detected",
  fraud_coercion: "Possible fraud or coercion detected",
};

export function computeTrustScore(analysis: AnalysisResult): TrustScore {
  const flags: RiskFlag[] = analysis.flags || [];
  const high = flags.filter((f) => f.severity === "high").length;
  const medium = flags.filter((f) => f.severity === "medium").length;
  const note = flags.filter((f) => f.severity === "note").length;
  const escalation = analysis.escalation?.triggered || false;

  // Scoring: start at 100, deduct per flag, deduct for escalation
  // high = -15, medium = -7, note = +2 (rewards presence of favorable clauses)
  // escalation = -25 (high-stakes situation warrants a real lawyer)
  let score = 100;
  score -= high * 15;
  score -= medium * 7;
  score += note * 2;
  if (escalation) score -= 25;
  score = Math.max(0, Math.min(100, score));

  // Tier determination
  let tier: TrustScore["tier"];
  let label: string;
  let rationale: string;

  if (escalation || high >= 3 || score < 35) {
    tier = "high_risk";
    label = "High risk";
    rationale = escalation && high >= 2
      ? `${high} high-impact clause${high === 1 ? "" : "s"} plus an escalation trigger (e.g., eviction, criminal, custody). A lawyer should review before signing.`
      : escalation
        ? "An escalation trigger was detected (e.g., eviction, criminal, custody, deadline). A lawyer should review before signing."
        : `${high} high-impact clause${high === 1 ? "" : "s"} found. Multiple rights waivers or uncapped liabilities warrant attorney review.`;
  } else if (high >= 1 || score < 65) {
    tier = "moderate";
    label = "Moderate concerns";
    rationale = `${high} high-impact clause${high === 1 ? "" : "s"} and ${medium} worth-understanding item${medium === 1 ? "" : "s"}. Review the flagged clauses carefully; consider negotiating the high-impact ones.`;
  } else if (medium <= 2 && score >= 80) {
    tier = "favorable";
    label = "Favorable";
    rationale = `No high-impact clauses, ${medium} minor item${medium === 1 ? "" : "s"} worth understanding. ${note} favorable term${note === 1 ? "" : "s"} present. Standard document with no major red flags.`;
  } else {
    tier = "balanced";
    label = "Balanced";
    rationale = `No high-impact clauses, ${medium} item${medium === 1 ? "" : "s"} worth understanding. ${note} favorable term${note === 1 ? "" : "s"} present. Review the medium items and proceed if comfortable.`;
  }

  return {
    score,
    tier,
    label,
    rationale,
    breakdown: {
      highFlags: high,
      mediumFlags: medium,
      noteFlags: note,
      escalationTriggered: escalation,
      totalFlags: high + medium + note,
    },
  };
}

export function buildPreSigningChecklist(analysis: AnalysisResult): PreSigningChecklist {
  const considerations: PreSigningChecklist["considerations"] = [];
  const questionsToAsk: PreSigningChecklist["questionsToAsk"] = [];
  const escalation: PreSigningChecklist["escalation"] = [];

  // Build considerations from each high/medium flag.
  // Include flag index in the ID to avoid collisions when multiple flags
  // share the same sourceClause + sourcePage (e.g., one clause with multiple issues).
  let considerationIdx = 0;
  let questionIdx = 0;
  for (const flag of analysis.flags || []) {
    if (flag.severity === "high" || flag.severity === "medium") {
      considerations.push({
        id: `consideration-${considerationIdx}-${flag.sourceClause}-${flag.sourcePage}-${flag.severity}`,
        text: `${flag.plainSummary} (${flag.severityLabel})`,
        citation: `[${flag.sourceClause} · p.${flag.sourcePage}]`,
        done: false,
      });
      considerationIdx++;
    }
    for (const q of flag.questionsToAsk || []) {
      questionsToAsk.push({
        id: `question-${questionIdx}-${flag.sourceClause}-${flag.sourcePage}`,
        text: q,
        category: flag.category,
        done: false,
      });
      questionIdx++;
    }
  }

  // Escalation item if triggered
  if (analysis.escalation?.triggered) {
    const category = analysis.escalation.category || "general";
    escalation.push({
      id: `escalation-0-${category}`,
      text: ESCALATION_CATEGORY_LABELS[category] || "Talk to a professional",
      category,
      done: false,
    });
  }

  return { considerations, questionsToAsk, escalation };
}
