// LegalLens shared types — used by API routes and client components.

export type Severity = "high" | "medium" | "note";

export type DocumentClass =
  | "residential_lease"
  | "nda"
  | "offer_severance"
  | "debt_collection"
  | "other";

export interface Citation {
  chip: string; // "[Clause 7.3 · p.4]"
  page: number;
  bbox?: [number, number, number, number];
  quote?: string;
}

export interface SummaryBullet {
  text: string;
  citation: string;
}

export interface RiskFlag {
  severity: Severity;
  severityLabel: string;
  category: string;
  plainSummary: string;
  sourceClause: string;
  sourcePage: number;
  sourceBbox?: [number, number, number, number];
  plainTranslation: string;
  questionsToAsk: string[];
}

export interface JargonTerm {
  term: string;
  plainDefinition: string;
  sourceClause: string;
  sourcePage: number;
}

export interface AnalysisResult {
  documentType: DocumentClass;
  documentTitlePlain: string;
  topCardIntro: string;
  summaryBullets: SummaryBullet[];
  flags: RiskFlag[];
  jargon: JargonTerm[];
  escalation: {
    triggered: boolean;
    category?: string;
    cardText?: string;
    referralLinks?: { label: string; url: string }[];
  };
  fleschKincaidGrade: number;
  disclaimer: string;
  trustScore?: TrustScore;
  preSigningChecklist?: PreSigningChecklist;
}

export interface TrustScore {
  score: number; // 0-100 (higher = more balanced / favorable for the user)
  tier: "high_risk" | "moderate" | "balanced" | "favorable";
  label: string;
  rationale: string;
  breakdown: {
    highFlags: number;
    mediumFlags: number;
    noteFlags: number;
    escalationTriggered: boolean;
    totalFlags: number;
  };
}

export interface PreSigningChecklist {
  considerations: Array<{ id: string; text: string; citation?: string; done: boolean }>;
  questionsToAsk: Array<{ id: string; text: string; category?: string; done: boolean }>;
  escalation: Array<{ id: string; text: string; category: string; done: boolean }>;
}

export interface QaResult {
  answer: string;
  citations: Citation[];
  inDocument: boolean;
  abstentionReason?: string;
  considerations: string[];
  escalationTriggered: boolean;
  adviceDetectorPassed: boolean;
}

export interface DocumentMeta {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  pageCount: number;
  textPreview: string;
  status: "uploaded" | "parsing" | "ready" | "error";
  errorMessage?: string;
  createdAt: string;
  expiresAt: string;
}

// Legal-aid referral links surfaced in escalation cards (per System Prompt R5).
export const LEGAL_AID_REFERRALS = [
  { label: "Legal Services Corporation — Find Legal Aid", url: "https://www.lsc.gov/about-lsc/what-should-i-do-when-i-need-legal-help" },
  { label: "LawHelp.org — Free Legal Help in Your State", url: "https://www.lawhelp.org/" },
  { label: "American Bar Association — Free Legal Help", url: "https://www.americanbar.org/groups/legal_services/flh-home/" },
] as const;
