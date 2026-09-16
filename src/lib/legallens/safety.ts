// Safety layer — advice-detector (R1) + injection filter (R6) + escalation trigger (R5)
// Lightweight keyword + pattern matchers used as pre/post-generation guardrails.
// In production this is replaced by the SetFit classifier, but the same surface.

import { ESCALATION_CATEGORIES } from "./system-prompt";

// R1 — Advice detector. Returns true if the text contains advice-directive language.
// Tuned for high recall (block + regenerate on positive).
const ADVICE_PATTERNS = [
  // Direct directives
  /\byou should\b/i,
  /\byou should not\b/i,
  /\byou must\b/i,
  /\byou must not\b/i,
  /\byou need to\b/i,
  /\byou have to\b/i,
  /\bdo not sign\b/i,
  /\bdon't sign\b/i,
  /\bsign this\b/i,
  /\bdecline this\b/i,
  /\bterminate the contract\b/i,
  /\breject this\b/i,
  /\baccept this\b/i,

  // Recommendations
  /\bI recommend\b/i,
  /\bI'd recommend\b/i,
  /\bI advise\b/i,
  /\bI strongly advise\b/i,
  /\bmy advice is\b/i,
  /\bI'd suggest\b/i,
  /\bI suggest\b/i,
  /\bI'd lean\b/i,
  /\bI'd think twice\b/i,
  /\bif I were you\b/i,
  /\byou might want to\b/i,
  /\byou may want to\b/i,
  /\bit might be worth\b/i,
  /\bit could be worth\b/i,
  /\bconsider not signing\b/i,
  /\bconsider not accepting\b/i,
  /\bconsider walking away\b/i,

  // Outcome predictions
  /\byou'll win\b/i,
  /\byou will win\b/i,
  /\byou'll lose\b/i,
  /\byou will lose\b/i,
  /\blose the case\b/i,
  /\bwin the case\b/i,
  /\bthis is unenforceable\b/i,
  /\bthis is enforceable\b/i,
  /\bthis will be enforced\b/i,
  /\bwon't hold up\b/i,
  /\bwill hold up\b/i,
  /\bwill be thrown out\b/i,
  /\bwill be interpreted against\b/i,
  /\bthe judge will\b/i,
  /\bcourts will invalidate\b/i,
  /\bcourts typically invalidate\b/i,

  // Leading questions
  /\bhave you considered\b/i,
  /\bwouldn't you rather\b/i,
  /\bwould you rather\b/i,
  /\bdon't you think\b/i,
  /\bdo you not think\b/i,
  /\baren't you worried\b/i,
  /\bwhy would you accept\b/i,
  /\bwhy would you sign\b/i,

  // Drafting help
  /\bhere's how to word\b/i,
  /\bhere is how to word\b/i,
  /\bdraft your response\b/i,
  /\bdraft your reply\b/i,
  /\bdraft your answer\b/i,
  /\bfile a motion\b/i,
  /\bfile an answer\b/i,
  /\bfile a complaint\b/i,
  /\bword your court filing\b/i,
  /\buse this template\b/i,

  // Jurisdiction-specific (outcome predictions tied to a state or jurisdiction)
  /\bunder california law\b/i,
  /\bunder new york law\b/i,
  /\bunder texas law\b/i,
  /\bunder .{3,30} law\b/i,
  /\bin most states\b/i,
  /\bin most jurisdictions\b/i,
  /\bmost states would\b/i,
  /\bmost jurisdictions\b/i,
  /\bunconscionable\b/i,
  /\bis invalid under\b/i,
  /\bthis clause is invalid\b/i,
  /\bunenforceable under\b/i,
  /\bcourts typically invalidate\b/i,
  /\bcourts generally (?:enforce|invalidate)\b/i,
];

export function detectAdvice(text: string): { isAdvice: boolean; matchedPatterns: string[] } {
  const matched: string[] = [];
  for (const pattern of ADVICE_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(pattern.source);
    }
  }
  return { isAdvice: matched.length > 0, matchedPatterns: matched };
}

// R6 — Injection filter. Detects prompt-injection payloads in document text.
// Blocks documents that contain explicit override instructions.
const INJECTION_PATTERNS = [
  /ignore (?:all )?(?:previous|prior) instructions/i,
  /ignore (?:all )?(?:prior|previous|the|above)? ?(?:system prompt|prompts)/i,
  /ignore (?:all )?prior/i,
  /disregard (?:all )?(?:previous|prior|the above)/i,
  /now act as/i,
  /pretend you are/i,
  /pretend you're/i,
  /you are now/i,
  /reveal (?:your )?system prompt/i,
  /reveal (?:your )?instructions/i,
  /(?:output|print|show) (?:your )?(?:system )?(?:prompt|instructions)/i,
];

export function detectInjection(text: string): { isInjection: boolean; matchedPatterns: string[] } {
  if (!text) return { isInjection: false, matchedPatterns: [] };
  const matched: string[] = [];
  const sample = text.slice(0, 50000); // sample first 50K chars
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sample)) {
      matched.push(pattern.source);
    }
  }
  return { isInjection: matched.length > 0, matchedPatterns: matched };
}

// R5 — Escalation trigger. Detects high-stakes situations in document text.
const ESCALATION_PATTERNS: Record<string, RegExp[]> = {
  eviction: [
    /\bevict(?:ion|ed|s)?\b/i,
    /\bnotice to quit\b/i,
    /\bunlawful detainer\b/i,
    /\bsummary process\b/i,
  ],
  foreclosure: [
    /\bforeclos(?:e|ure|ing)?\b/i,
    /\bnotice of default\b/i,
    /\bsheriff'?s sale\b/i,
  ],
  immigration: [
    /\bdeport(?:ation|ed|ing)?\b/i,
    /\bremoval proceedings\b/i,
    /\bimmigration (?:court|judge|case)\b/i,
    /\bICE (?:detainer|hold|custody)\b/i,
    /\bnotice to appear\b/i,
  ],
  criminal: [
    /\bcriminal charge(?:s)?\b/i,
    /\barr(?:aignment|aigned)\b/i,
    /\bindictment\b/i,
    /\bplea (?:deal|bargain|agreement)\b/i,
    /\bpublic defender\b/i,
  ],
  custody_divorce: [
    /\bcustody\b/i,
    /\bdivorce\b/i,
    /\bdissolution of marriage\b/i,
    /\bchild support\b/i,
    /\bspousal support\b/i,
    /\bvisitation (?:rights|schedule)\b/i,
    /\bfamily court\b/i,
  ],
  being_sued: [
    /\byou (?:have|are) been sued\b/i,
    /\bsummons and complaint\b/i,
    /\bbeing served\b/i,
    /\bservice of process\b/i,
  ],
  response_deadline: [
    /\b(?:within|you have) \d+ (?:days?|hours?|weeks?) to (?:respond|answer|reply|appeal|file)\b/i,
    /\bresponse deadline\b/i,
    /\banswer (?:by|before) \w+\b/i,
  ],
  fraud_coercion: [
    /\bunder duress\b/i,
    /\bcoerced\b/i,
    /\bforced to sign\b/i,
    /\bfraud\b/i,
    /\bidentity theft\b/i,
  ],
};

export function detectEscalation(text: string): { triggered: boolean; category?: string } {
  if (!text) return { triggered: false };
  for (const category of ESCALATION_CATEGORIES) {
    const patterns = ESCALATION_PATTERNS[category];
    if (patterns) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return { triggered: true, category };
        }
      }
    }
  }
  return { triggered: false };
}

// Flesch-Kincaid grade level estimator — used to verify R3 (≤ 8.0).
export function fleschKincaidGrade(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  if (sentences.length === 0 || words.length === 0) return 0;
  // Flesch-Kincaid Grade Level formula
  const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  // Count vowel groups
  const groups = w.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;
  // Subtract for silent e at end
  if (w.endsWith("e")) count = Math.max(1, count - 1);
  return Math.max(1, count);
}
