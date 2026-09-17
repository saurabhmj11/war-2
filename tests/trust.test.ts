import { describe, it, expect } from "vitest";
import { computeTrustScore, buildPreSigningChecklist } from "../src/lib/legallens/trust";
import type { AnalysisResult, RiskFlag } from "../src/lib/legallens/types";

function makeFlag(severity: "high" | "medium" | "note", category = "test"): RiskFlag {
  return {
    severity,
    severityLabel:
      severity === "high" ? "High-impact clause" :
      severity === "medium" ? "Worth understanding" :
      "Standard or favorable",
    category,
    plainSummary: `Test ${severity} flag`,
    sourceClause: "Clause 1",
    sourcePage: 1,
    sourceBbox: [0, 0, 100, 100],
    plainTranslation: `Translation for ${severity} flag`,
    questionsToAsk: [`Question for ${severity}`],
  };
}

function makeAnalysis(flags: RiskFlag[], escalation = false): AnalysisResult {
  return {
    documentType: "residential_lease",
    documentTitlePlain: "Test lease",
    topCardIntro: "This is a test lease.",
    summaryBullets: [],
    flags,
    jargon: [],
    escalation: {
      triggered: escalation,
      referralLinks: [],
    },
    fleschKincaidGrade: 7.0,
    disclaimer: "Test disclaimer",
  };
}

// ─── Trust Score computation ───
describe("computeTrustScore", () => {
  it("returns 100 (favorable) for a clean document with no flags", () => {
    const analysis = makeAnalysis([]);
    const score = computeTrustScore(analysis);
    expect(score.score).toBe(100);
    expect(score.tier).toBe("favorable");
    expect(score.label).toBe("Favorable");
    expect(score.breakdown.highFlags).toBe(0);
    expect(score.breakdown.mediumFlags).toBe(0);
    expect(score.breakdown.noteFlags).toBe(0);
    expect(score.breakdown.escalationTriggered).toBe(false);
  });

  it("deducts 15 per high-impact flag", () => {
    const analysis = makeAnalysis([makeFlag("high"), makeFlag("high")]);
    const score = computeTrustScore(analysis);
    // 100 - 15*2 = 70
    expect(score.score).toBe(70);
    expect(score.breakdown.highFlags).toBe(2);
  });

  it("deducts 7 per medium flag", () => {
    const analysis = makeAnalysis([makeFlag("medium"), makeFlag("medium"), makeFlag("medium")]);
    const score = computeTrustScore(analysis);
    // 100 - 7*3 = 79
    expect(score.score).toBe(79);
    expect(score.breakdown.mediumFlags).toBe(3);
  });

  it("rewards note flags with +2 each", () => {
    const analysis = makeAnalysis([makeFlag("note"), makeFlag("note"), makeFlag("note")]);
    const score = computeTrustScore(analysis);
    // 100 + 2*3 = 106 → clamped to 100
    expect(score.score).toBe(100);
    expect(score.breakdown.noteFlags).toBe(3);
  });

  it("deducts 25 for escalation trigger", () => {
    const analysis = makeAnalysis([makeFlag("medium")], true);
    const score = computeTrustScore(analysis);
    // 100 - 7 - 25 = 68
    expect(score.score).toBe(68);
    expect(score.breakdown.escalationTriggered).toBe(true);
  });

  it("clamps to 0 minimum", () => {
    const analysis = makeAnalysis([
      makeFlag("high"), makeFlag("high"), makeFlag("high"), makeFlag("high"),
      makeFlag("high"), makeFlag("high"), makeFlag("high"), makeFlag("high"),
    ], true);
    const score = computeTrustScore(analysis);
    // 100 - 15*8 - 25 = -45 → clamped to 0
    expect(score.score).toBe(0);
    expect(score.tier).toBe("high_risk");
    expect(score.label).toBe("High risk");
  });

  it("clamps to 100 maximum", () => {
    const analysis = makeAnalysis([makeFlag("note"), makeFlag("note"), makeFlag("note"), makeFlag("note")]);
    const score = computeTrustScore(analysis);
    expect(score.score).toBe(100);
  });

  it("classifies as high_risk when escalation + 2+ high flags", () => {
    const analysis = makeAnalysis([makeFlag("high"), makeFlag("high")], true);
    const score = computeTrustScore(analysis);
    expect(score.tier).toBe("high_risk");
  });

  it("classifies as high_risk when 3+ high flags (no escalation)", () => {
    const analysis = makeAnalysis([makeFlag("high"), makeFlag("high"), makeFlag("high")]);
    const score = computeTrustScore(analysis);
    expect(score.tier).toBe("high_risk");
  });

  it("classifies as moderate when 1 high flag, no escalation", () => {
    const analysis = makeAnalysis([makeFlag("high"), makeFlag("medium")]);
    const score = computeTrustScore(analysis);
    // 100 - 15 - 7 = 78 → moderate
    expect(score.tier).toBe("moderate");
  });

  it("classifies as favorable when 0 high + 0 medium + few notes", () => {
    const analysis = makeAnalysis([makeFlag("note"), makeFlag("note")]);
    const score = computeTrustScore(analysis);
    expect(score.tier).toBe("favorable");
  });

  it("always provides a rationale string", () => {
    const analysis = makeAnalysis([makeFlag("high")], true);
    const score = computeTrustScore(analysis);
    expect(score.rationale).toBeTruthy();
    expect(typeof score.rationale).toBe("string");
    expect(score.rationale.length).toBeGreaterThan(10);
  });

  it("breakdown.totalFlags equals sum of all severities", () => {
    const analysis = makeAnalysis([
      makeFlag("high"), makeFlag("high"),
      makeFlag("medium"), makeFlag("medium"), makeFlag("medium"),
      makeFlag("note"),
    ]);
    const score = computeTrustScore(analysis);
    expect(score.breakdown.totalFlags).toBe(6);
  });
});

// ─── Pre-signing checklist ───
describe("buildPreSigningChecklist", () => {
  it("returns empty lists for a clean document", () => {
    const analysis = makeAnalysis([]);
    const checklist = buildPreSigningChecklist(analysis);
    expect(checklist.considerations).toEqual([]);
    expect(checklist.questionsToAsk).toEqual([]);
    expect(checklist.escalation).toEqual([]);
  });

  it("creates a consideration per high/medium flag (not for note flags)", () => {
    const analysis = makeAnalysis([
      makeFlag("high"),
      makeFlag("medium"),
      makeFlag("note"), // should NOT create a consideration
    ]);
    const checklist = buildPreSigningChecklist(analysis);
    expect(checklist.considerations.length).toBe(2);
    expect(checklist.considerations[0].text).toContain("Test high flag");
    expect(checklist.considerations[1].text).toContain("Test medium flag");
  });

  it("creates a question per flag.questionsToAsk entry", () => {
    const analysis = makeAnalysis([
      makeFlag("high"),
      makeFlag("medium"),
    ]);
    const checklist = buildPreSigningChecklist(analysis);
    expect(checklist.questionsToAsk.length).toBe(2);
    expect(checklist.questionsToAsk[0].text).toContain("Question for");
  });

  it("creates an escalation item when escalation.triggered is true", () => {
    const analysis = makeAnalysis([makeFlag("medium")], true);
    const checklist = buildPreSigningChecklist(analysis);
    expect(checklist.escalation.length).toBe(1);
    expect(checklist.escalation[0].category).toBeTruthy();
  });

  it("all items have unique IDs", () => {
    const analysis = makeAnalysis([
      makeFlag("high"),
      makeFlag("medium"),
      makeFlag("note"),
    ]);
    const checklist = buildPreSigningChecklist(analysis);
    const allIds = [
      ...checklist.considerations.map(c => c.id),
      ...checklist.questionsToAsk.map(q => q.id),
      ...checklist.escalation.map(e => e.id),
    ];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it("all items start with done=false", () => {
    const analysis = makeAnalysis([makeFlag("high"), makeFlag("medium")], true);
    const checklist = buildPreSigningChecklist(analysis);
    expect(checklist.considerations.every(c => c.done === false)).toBe(true);
    expect(checklist.questionsToAsk.every(q => q.done === false)).toBe(true);
    expect(checklist.escalation.every(e => e.done === false)).toBe(true);
  });

  it("considerations include citation chips", () => {
    const analysis = makeAnalysis([makeFlag("high")]);
    const checklist = buildPreSigningChecklist(analysis);
    expect(checklist.considerations[0].citation).toBeTruthy();
    expect(checklist.considerations[0].citation).toContain("Clause 1");
    expect(checklist.considerations[0].citation).toContain("p.1");
  });
});
