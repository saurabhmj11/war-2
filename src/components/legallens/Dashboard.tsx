/* eslint-disable */
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Scale, ShieldCheck, AlertTriangle, CheckSquare, ListChecks, FileText, MessageCircleQuestion, Loader2, X, Clock, ArrowRight, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import type { TrustScore, PreSigningChecklist, DocumentMeta, AnalysisResult } from "@/lib/legallens/types";

// ─── TrustScore Badge ───
export function TrustScoreBadge({ score }: { score: TrustScore }) {
  const tierColor =
    score.tier === "high_risk" ? "text-red-700 bg-red-500/10 border-red-500/30" :
    score.tier === "moderate" ? "text-amber-700 bg-amber-500/10 border-amber-500/30" :
    score.tier === "favorable" ? "text-emerald-700 bg-emerald-500/10 border-emerald-500/30" :
    "text-sky-700 bg-sky-500/10 border-sky-500/30";

  const ringColor =
    score.tier === "high_risk" ? "stroke-red-500" :
    score.tier === "moderate" ? "stroke-amber-500" :
    score.tier === "favorable" ? "stroke-emerald-500" :
    "stroke-sky-500";

  return (
    <Card className={`border ${tierColor}`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 relative h-14 w-14">
            <svg viewBox="0 0 36 36" className="h-14 w-14">
              <circle cx="18" cy="18" r="15" fill="none" className="stroke-muted/30" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15" fill="none"
                className={ringColor}
                strokeWidth="3"
                strokeDasharray={`${(score.score / 100) * 94.25} 94.25`}
                strokeLinecap="round"
                transform="rotate(-90 18 18)"
              />
              <text x="18" y="22" textAnchor="middle" className="fill-current text-[10px] font-bold">{score.score}</text>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Scale className="h-4 w-4 flex-shrink-0" />
              <h3 className="text-sm font-bold">{score.label}</h3>
              <Badge variant="outline" className="text-[10px] font-normal">{score.score}/100</Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{score.rationale}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              <Badge variant="secondary" className="text-[10px]">{score.breakdown.highFlags} high</Badge>
              <Badge variant="secondary" className="text-[10px]">{score.breakdown.mediumFlags} medium</Badge>
              <Badge variant="secondary" className="text-[10px]">{score.breakdown.noteFlags} note</Badge>
              {score.breakdown.escalationTriggered && (
                <Badge variant="destructive" className="text-[10px]">escalation</Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Pre-Signing Checklist ───
interface ChecklistProps {
  documentId: string;
  checklist: PreSigningChecklist;
  onCitationClick?: (docId: string, page: number, bbox?: [number, number, number, number]) => void;
}

export function PreSigningChecklistCard({ documentId, checklist, onCitationClick }: ChecklistProps) {
  // Load saved state from localStorage
  const storageKey = `legallens-checklist-${documentId}`;
  const [items, setItems] = useState<PreSigningChecklist>(() => {
    if (typeof window === "undefined") return checklist;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const savedState = JSON.parse(saved) as Record<string, boolean>;
        return {
          considerations: checklist.considerations.map((c) => ({ ...c, done: savedState[c.id] ?? c.done })),
          questionsToAsk: checklist.questionsToAsk.map((q) => ({ ...q, done: savedState[q.id] ?? q.done })),
          escalation: checklist.escalation.map((e) => ({ ...e, done: savedState[e.id] ?? e.done })),
        };
      }
    } catch {}
    return checklist;
  });

  // Save on change
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved: Record<string, boolean> = {};
    [...items.considerations, ...items.questionsToAsk, ...items.escalation].forEach((i) => {
      saved[i.id] = i.done;
    });
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch {}
  }, [items, storageKey]);

  const toggle = useCallback((section: "considerations" | "questionsToAsk" | "escalation", id: string) => {
    setItems((prev) => ({
      ...prev,
      [section]: prev[section].map((i) => i.id === id ? { ...i, done: !i.done } : i),
    }));
  }, []);

  const totalDone = [
    ...items.considerations,
    ...items.questionsToAsk,
    ...items.escalation,
  ].filter((i) => i.done).length;
  const totalItems = items.considerations.length + items.questionsToAsk.length + items.escalation.length;
  const progressPct = totalItems === 0 ? 0 : Math.round((totalDone / totalItems) * 100);

  if (totalItems === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-orange-600" />
            <CardTitle className="text-base">Pre-signing checklist</CardTitle>
          </div>
          <Badge variant="outline" className="text-[10px]">{totalDone}/{totalItems} done</Badge>
        </div>
        <CardDescription className="text-xs">
          Action plan derived from this document. Check off items as you complete them — your progress is saved locally for 24h.
        </CardDescription>
        <Progress value={progressPct} className="h-1.5 mt-2" />
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {items.escalation.length > 0 && (
          <ChecklistSection
            title="Escalation"
            icon={<AlertTriangle className="h-3 w-3 text-red-600" />}
            items={items.escalation}
            onToggle={(id) => toggle("escalation", id)}
          />
        )}
        {items.considerations.length > 0 && (
          <ChecklistSection
            title="Things to weigh"
            icon={<Scale className="h-3 w-3 text-amber-600" />}
            items={items.considerations}
            onToggle={(id) => toggle("considerations", id)}
            onCitationClick={(page) => onCitationClick?.(documentId, page)}
            showCitation
          />
        )}
        {items.questionsToAsk.length > 0 && (
          <ChecklistSection
            title="Questions to ask"
            icon={<MessageCircleQuestion className="h-3 w-3 text-sky-600" />}
            items={items.questionsToAsk}
            onToggle={(id) => toggle("questionsToAsk", id)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ChecklistSection({
  title, icon, items, onToggle, onCitationClick, showCitation,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{ id: string; text: string; citation?: string; category?: string; done: boolean }>;
  onToggle: (id: string) => void;
  onCitationClick?: (page: number) => void;
  showCitation?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
        {icon} {title}
      </p>
      <div className="space-y-1">
        {items.map((item) => {
          const pageNum = item.citation?.match(/p\.?\s*(\d+)/i)?.[1];
          return (
            <div key={item.id} className={`flex items-start gap-2 p-2 rounded-md ${item.done ? "bg-muted/40 opacity-60" : "hover:bg-muted/30"}`}>
              <Checkbox
                checked={item.done}
                onCheckedChange={() => onToggle(item.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-xs leading-relaxed ${item.done ? "line-through" : ""}`}>
                  {item.text}
                  {item.citation && showCitation && (
                    <button
                      onClick={() => pageNum && onCitationClick?.(parseInt(pageNum, 10))}
                      className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/10 hover:bg-orange-500/20 text-orange-700 text-[11px] font-mono"
                    >
                      {item.citation}
                    </button>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Multi-Document Ask Box ───
interface MultiAskProps {
  documents: DocumentMeta[]; // all docs user has uploaded
  onFocusSource?: (docId: string, page: number, bbox?: [number, number, number, number]) => void;
}

interface MultiAskResult {
  answer: string;
  citations: Array<{ chip: string; documentId: string; documentFileName: string; page: number; bbox?: [number, number, number, number]; quote?: string }>;
  inDocument: boolean;
  abstentionReason?: string;
  considerations: string[];
  escalationTriggered: boolean;
  adviceDetectorPassed: boolean;
  perDocCoverage: Array<{ documentId: string; documentFileName: string; cited: boolean }>;
  disclaimer: string;
}

export function MultiAskCard({ documents, onFocusSource }: MultiAskProps) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MultiAskResult | null>(null);
  const [history, setHistory] = useState<{ q: string; a: MultiAskResult }[]>([]);

  const ask = useCallback(async () => {
    if (!question.trim() || loading || documents.length === 0) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/legallens/multi-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), documentIds: documents.map((d) => d.id) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }
      const data: MultiAskResult = await res.json();
      setResult(data);
      setHistory((h) => [{ q: question.trim(), a: data }, ...h].slice(0, 5));
      setQuestion("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Multi-ask failed");
    } finally {
      setLoading(false);
    }
  }, [question, loading, documents]);

  if (documents.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-orange-600" />
          <CardTitle className="text-base">Ask across all your documents</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Ask one question; get answers citing whichever of your {documents.length} document{documents.length === 1 ? "" : "s"} {documents.length === 1 ? "contains" : "contain"} the relevant content.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
            placeholder="Which of my leases has the shortest notice period?"
            disabled={loading}
            className="text-sm"
          />
          <Button size="sm" onClick={ask} disabled={loading || !question.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ask"}
          </Button>
        </div>

        {result && (
          <MultiAskResultView result={result} onFocusSource={onFocusSource} />
        )}

        {history.length > 0 && (
          <div className="space-y-2 mt-2">
            <p className="text-xs text-muted-foreground">Previous questions:</p>
            {history.map((h, i) => (
              <details key={i} className="text-xs">
                <summary className="cursor-pointer hover:underline">{h.q}</summary>
                <MultiAskResultView result={h.a} onFocusSource={onFocusSource} compact />
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MultiAskResultView({
  result, onFocusSource, compact,
}: {
  result: MultiAskResult;
  onFocusSource?: (docId: string, page: number, bbox?: [number, number, number, number]) => void;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-md border bg-muted/30 ${compact ? "p-2 mt-1" : "p-3"} space-y-2`}>
      {!result.inDocument && (
        <div className="flex items-center gap-2 text-xs text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          <span>Not addressed in any of your documents.</span>
        </div>
      )}
      <p className="text-sm leading-relaxed">{result.answer}</p>

      {result.perDocCoverage && result.perDocCoverage.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.perDocCoverage.map((cov) => (
            <Badge
              key={cov.documentId}
              variant={cov.cited ? "default" : "outline"}
              className={`text-[10px] ${cov.cited ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" : "text-muted-foreground"}`}
            >
              {cov.cited ? "✓" : "—"} {cov.documentFileName.length > 20 ? cov.documentFileName.slice(0, 17) + "…" : cov.documentFileName}
            </Badge>
          ))}
        </div>
      )}

      {result.citations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.citations.map((c, i) => (
            <button
              key={i}
              onClick={() => onFocusSource?.(c.documentId, c.page, c.bbox)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/10 hover:bg-orange-500/20 text-orange-700 text-[11px] font-mono"
            >
              {c.chip}
            </button>
          ))}
        </div>
      )}

      {result.considerations.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Things to weigh:</span>
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            {result.considerations.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {result.escalationTriggered && (
        <div className="text-xs text-amber-700 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> This may warrant a conversation with a lawyer.
        </div>
      )}
    </div>
  );
}

// ─── Dashboard (replaces upload screen when 1+ docs exist) ───
interface DashboardProps {
  documents: DocumentMeta[];
  onSelectDoc: (id: string) => void;
  onUploadNew: () => void;
}

export function Dashboard({ documents, onSelectDoc, onUploadNew }: DashboardProps) {
  const [docScores, setDocScores] = useState<Record<string, TrustScore | null>>({});

  // Fetch each doc's latest analysis to get its trust score (lightweight: only summaryJson)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const newScores: Record<string, TrustScore | null> = {};
      for (const doc of documents.slice(0, 12)) {
        try {
          const res = await fetch(`/api/legallens/analyze?documentId=${encodeURIComponent(doc.id)}`, { method: "GET" });
          if (res.ok) {
            const data: AnalysisResult = await res.json();
            newScores[doc.id] = data.trustScore || null;
          }
        } catch {}
      }
      if (!cancelled) setDocScores(newScores);
    })();
    return () => { cancelled = true; };
  }, [documents]);

  return (
    <div className="max-w-5xl mx-auto py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Your documents</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {documents.length} document{documents.length === 1 ? "" : "s"} · all auto-delete within 24h
          </p>
        </div>
        <Button onClick={onUploadNew} size="sm">
          <FileText className="h-4 w-4 mr-1" /> Upload new
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {documents.map((doc) => {
          const score = docScores[doc.id];
          const timeLeft = Math.max(0, new Date(doc.expiresAt).getTime() - Date.now());
          const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
          return (
            <Card
              key={doc.id}
              className="hover:shadow-md hover:border-orange-500/40 transition-all cursor-pointer"
              onClick={() => onSelectDoc(doc.id)}
            >
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-2 mb-3">
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.fileName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {doc.pageCount} page{doc.pageCount === 1 ? "" : "s"} · {(doc.fileSize / 1024).toFixed(0)} KB
                    </p>
                  </div>
                </div>

                {score ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Trust score</span>
                        <span className={`text-sm font-bold ${
                          score.tier === "high_risk" ? "text-red-600" :
                          score.tier === "moderate" ? "text-amber-600" :
                          score.tier === "favorable" ? "text-emerald-600" :
                          "text-sky-600"
                        }`}>{score.score}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full ${
                            score.tier === "high_risk" ? "bg-red-500" :
                            score.tier === "moderate" ? "bg-amber-500" :
                            score.tier === "favorable" ? "bg-emerald-500" :
                            "bg-sky-500"
                          }`}
                          style={{ width: `${score.score}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Loading score…</span>
                  </div>
                )}

                <div className="flex items-center gap-1 mt-3 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Expires in {hoursLeft}h</span>
                  <ArrowRight className="h-3 w-3 ml-auto" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Impact Analysis (lazy-loaded per risk flag) ───
import type { ImpactAnalysis } from "@/app/api/legallens/impact/route";

interface ImpactAnalysisProps {
  documentId: string;
  flag: {
    severity: string;
    category: string;
    plainSummary: string;
    sourceClause: string;
    sourcePage: number;
    plainTranslation: string;
  };
}

const impactCache = new Map<string, ImpactAnalysis>(); // key: `${documentId}-${sourceClause}-${sourcePage}`

export function ImpactAnalysisCard({ documentId, flag }: ImpactAnalysisProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImpactAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cacheKey = `${documentId}-${flag.sourceClause}-${flag.sourcePage}`;

  // Load from cache on mount
  useEffect(() => {
    const cached = impactCache.get(cacheKey);
    if (cached) setResult(cached);
  }, [cacheKey]);

  const load = useCallback(async () => {
    if (loading || result) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/legallens/impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, flag }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }
      const data: ImpactAnalysis = await res.json();
      impactCache.set(cacheKey, data);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impact analysis failed");
    } finally {
      setLoading(false);
    }
  }, [loading, result, documentId, flag, cacheKey]);

  if (loading) {
    return (
      <div className="mt-3 p-3 rounded-md border bg-muted/30 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Analyzing impact…</span>
        </div>
        <div className="space-y-1.5">
          <div className="h-2 bg-muted/50 rounded animate-pulse" />
          <div className="h-2 bg-muted/50 rounded w-3/4 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 p-3 rounded-md border bg-destructive/5 border-destructive/30">
        <p className="text-xs text-destructive">{error}</p>
        <button onClick={load} className="text-xs text-orange-600 hover:underline mt-1">Retry</button>
      </div>
    );
  }

  if (!result) {
    return (
      <button
        onClick={load}
        className="mt-2 inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 hover:underline"
      >
        <Scale className="h-3 w-3" /> Show impact analysis (fair version + exposure estimate)
      </button>
    );
  }

  const riskColor =
    result.riskLevel === "critical" ? "text-red-700 bg-red-500/10 border-red-500/30" :
    result.riskLevel === "high" ? "text-orange-700 bg-orange-500/10 border-orange-500/30" :
    result.riskLevel === "medium" ? "text-amber-700 bg-amber-500/10 border-amber-500/30" :
    "text-emerald-700 bg-emerald-500/10 border-emerald-500/30";

  return (
    <div className="mt-3 p-3 rounded-md border bg-muted/30 space-y-3">
      {/* Risk level badge */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={`text-[10px] ${riskColor}`}>
          {result.riskLevel === "critical" ? "Critical exposure" :
           result.riskLevel === "high" ? "High exposure" :
           result.riskLevel === "medium" ? "Medium exposure" :
           "Low exposure"}
        </Badge>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Impact analysis</span>
      </div>

      {/* Fair version example */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-emerald-600" /> What a balanced version looks like
        </p>
        <p className="text-xs leading-relaxed">{result.fairVersionExample}</p>
        <p className="text-[10px] text-muted-foreground italic mt-1">{result.fairVersionRationale}</p>
      </div>

      {/* Breach scenario */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 text-amber-600" /> If this clause bites
        </p>
        <p className="text-xs leading-relaxed">{result.breachScenario}</p>
      </div>

      {/* Estimated exposure */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          Estimated financial exposure
        </p>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold">{result.estimatedExposure.low}</span>
          <span className="text-[10px] text-muted-foreground">to</span>
          <span className="text-sm font-bold">{result.estimatedExposure.high}</span>
        </div>
        <p className="text-[10px] text-muted-foreground italic mt-0.5">{result.estimatedExposure.description}</p>
      </div>

      {/* Mitigation options */}
      {result.mitigationOptions && result.mitigationOptions.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Things to ask the other party
          </p>
          <ul className="text-xs space-y-1 ml-3">
            {result.mitigationOptions.map((m, i) => (
              <li key={i} className="list-disc">{m}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground italic">
        Estimates are rough ranges based on typical disputes for this clause type — not legal advice. Actual exposure depends on jurisdiction, facts, and counsel.
      </p>
    </div>
  );
}
