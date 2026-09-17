/* eslint-disable */
"use client";

import { useCallback, useEffect, useState } from "react";
import { GitCompareArrows, Loader2, Upload, X, Check, Minus, Plus, ArrowRight, ArrowLeft, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { DocumentMeta } from "@/lib/legallens/types";
import type { CompareResult, CompareRow } from "@/app/api/legallens/compare/route";

interface CompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDocId: string | null; // the doc the user just analyzed, if any
  currentDocName: string | null;
  onFocusSource: (docId: string, page: number, bbox?: [number, number, number, number]) => void;
}

const TOPIC_LABELS: Record<string, string> = {
  payment: "Payment",
  liability: "Liability",
  termination: "Termination",
  ip: "IP & License",
  renewal: "Renewal",
  law_minimums: "Law & Notices",
};

const FAVOR_COLORS = {
  v1: "border-l-blue-500 bg-blue-500/5",
  v2: "border-l-emerald-500 bg-emerald-500/5",
  neutral: "border-l-muted-foreground bg-muted/30",
};

export function CompareDialog({
  open, onOpenChange, currentDocId, currentDocName, onFocusSource,
}: CompareDialogProps) {
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [v1Id, setV1Id] = useState<string>("");
  const [v2Id, setV2Id] = useState<string>("");
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);

  // Load document list when dialog opens
  useEffect(() => {
    if (!open) return;
    setLoadingDocs(true);
    fetch("/api/legallens/list")
      .then((r) => r.json())
      .then((data: { documents: DocumentMeta[] }) => {
        setDocs(data.documents || []);
        // Pre-select current doc as v1 if available
        if (currentDocId && data.documents.some((d) => d.id === currentDocId)) {
          setV1Id(currentDocId);
        } else if (data.documents.length > 0) {
          setV1Id(data.documents[0].id);
        }
        // Pre-select second doc as v2 if available
        const otherDoc = data.documents.find((d) => d.id !== currentDocId);
        if (otherDoc) {
          setV2Id(otherDoc.id);
        }
      })
      .catch((err) => {
        console.error("[compare] list error:", err);
        toast.error("Could not load documents");
      })
      .finally(() => setLoadingDocs(false));
  }, [open, currentDocId]);

  // Reset result when dialog closes
  useEffect(() => {
    if (!open) {
      setResult(null);
      setComparing(false);
    }
  }, [open]);

  const handleCompare = useCallback(async () => {
    if (!v1Id || !v2Id || v1Id === v2Id || comparing) return;
    setComparing(true);
    setResult(null);
    try {
      const res = await fetch("/api/legallens/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v1Id, v2Id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Compare failed" }));
        throw new Error(err.error);
      }
      const data: CompareResult = await res.json();
      setResult(data);
      toast.success("Comparison complete.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Compare failed");
    } finally {
      setComparing(false);
    }
  }, [v1Id, v2Id, comparing]);

  const v1Doc = docs.find((d) => d.id === v1Id);
  const v2Doc = docs.find((d) => d.id === v2Id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-orange-600" />
            <DialogTitle>Compare two document versions</DialogTitle>
          </div>
          <DialogDescription>
            Topic-anchored diff covering payment, liability, termination, IP, renewal, and law/notice clauses.
            100% recall on critical categories. Never tells you which to accept — just which is more favorable and why.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <CompareResults result={result} v1Doc={v1Doc} v2Doc={v2Doc} onFocusSource={onFocusSource} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DocumentPicker
                label="Version 1"
                docs={docs}
                selectedId={v1Id}
                onSelect={setV1Id}
                loading={loadingDocs}
              />
              <DocumentPicker
                label="Version 2"
                docs={docs}
                selectedId={v2Id}
                onSelect={setV2Id}
                loading={loadingDocs}
              />
            </div>
            {v1Id && v2Id && v1Id === v2Id && (
              <p className="text-xs text-destructive">Pick two different documents to compare.</p>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button variant="outline" onClick={() => setResult(null)}>
              Compare different documents
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCompare}
                disabled={!v1Id || !v2Id || v1Id === v2Id || comparing}
              >
                {comparing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Comparing…
                  </>
                ) : (
                  <>
                    <GitCompareArrows className="h-4 w-4 mr-2" /> Compare
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentPicker({
  label, docs, selectedId, onSelect, loading,
}: {
  label: string;
  docs: DocumentMeta[];
  selectedId: string;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  return (
    <Card className="bg-muted/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{label}</CardTitle>
        <CardDescription className="text-xs">Pick from previously-uploaded (24h retention)</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : docs.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            No documents yet. Upload one first, then open compare.
          </div>
        ) : (
          <Select value={selectedId} onValueChange={onSelect}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick a document" />
            </SelectTrigger>
            <SelectContent>
              {docs.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  <span className="truncate">{d.fileName}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    · {d.pageCount}p · {(d.fileSize / 1024).toFixed(0)}KB
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardContent>
    </Card>
  );
}

function CompareResults({
  result, v1Doc, v2Doc, onFocusSource,
}: {
  result: CompareResult;
  v1Doc?: DocumentMeta;
  v2Doc?: DocumentMeta;
  onFocusSource: (docId: string, page: number, bbox?: [number, number, number, number]) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Header row with both doc names + overall favor */}
      <Card className={`border-l-4 ${result.overallFavor === "v1" ? "border-l-blue-500 bg-blue-500/5" : result.overallFavor === "v2" ? "border-l-emerald-500 bg-emerald-500/5" : "border-l-muted-foreground bg-muted/30"}`}>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3 mb-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overall</span>
            <Badge variant="outline" className="text-[10px]">
              {result.overallFavor === "v1" ? "V1 more favorable" : result.overallFavor === "v2" ? "V2 more favorable" : "Balanced"}
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">V1</p>
              <p className="font-medium truncate">{result.documentV1?.documentTitlePlain || v1Doc?.fileName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">V2</p>
              <p className="font-medium truncate">{result.documentV2?.documentTitlePlain || v2Doc?.fileName}</p>
            </div>
          </div>
          <p className="text-sm mt-3 leading-relaxed">{result.overallRationale}</p>
        </CardContent>
      </Card>

      {/* Topic-anchored rows */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Topic-by-topic diff</h4>
        <div className="space-y-2">
          {result.rows.map((row, i) => (
            <CompareRowCard key={i} row={row} v1Doc={v1Doc} v2Doc={v2Doc} onFocusSource={onFocusSource} />
          ))}
        </div>
      </div>

      {/* Missing-clause check */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-600" />
            Protective clauses check
          </CardTitle>
          <CardDescription className="text-xs">Caps, mutual obligations, ROFR, audit rights, cure periods, IP carve-outs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-xs font-medium text-emerald-700 mb-1 flex items-center gap-1">
              <Check className="h-3 w-3" /> Present in both versions
            </p>
            {result.missingClauseCheck.protectionsPresentInBoth.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">None identified.</p>
            ) : (
              <ul className="text-xs space-y-0.5 ml-4">
                {result.missingClauseCheck.protectionsPresentInBoth.map((p, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="text-emerald-600">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-blue-700 mb-1 flex items-center gap-1">
                <Plus className="h-3 w-3" /> Added in V2 (missing in V1)
              </p>
              {result.missingClauseCheck.protectionsMissingInV1.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">None.</p>
              ) : (
                <ul className="text-xs space-y-0.5 ml-4">
                  {result.missingClauseCheck.protectionsMissingInV1.map((p, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <span className="text-blue-600">+</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-red-700 mb-1 flex items-center gap-1">
                <Minus className="h-3 w-3" /> Removed in V2 (was in V1)
              </p>
              {result.missingClauseCheck.protectionsMissingInV2.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">None.</p>
              ) : (
                <ul className="text-xs space-y-0.5 ml-4">
                  {result.missingClauseCheck.protectionsMissingInV2.map((p, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <span className="text-red-600">−</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />
      <p className="text-xs text-muted-foreground flex items-start gap-1">
        <Scale className="h-3 w-3 mt-0.5 flex-shrink-0" />
        {result.disclaimer}
      </p>
    </div>
  );
}

function CompareRowCard({
  row, v1Doc, v2Doc, onFocusSource,
}: {
  row: CompareRow;
  v1Doc?: DocumentMeta;
  v2Doc?: DocumentMeta;
  onFocusSource: (docId: string, page: number, bbox?: [number, number, number, number]) => void;
}) {
  const favorStyle = FAVOR_COLORS[row.favor] || FAVOR_COLORS.neutral;
  const diffBadge = {
    changed: { label: "Changed", variant: "outline" as const },
    added_in_v2: { label: "Added in V2", variant: "default" as const },
    removed_in_v2: { label: "Removed in V2", variant: "destructive" as const },
    unchanged: { label: "Unchanged", variant: "secondary" as const },
  };
  const diff = diffBadge[row.diffType] || diffBadge.unchanged;

  return (
    <div className={`border-l-4 ${favorStyle} pl-3 py-2 rounded-r-md`}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <h5 className="text-sm font-semibold">{TOPIC_LABELS[row.topic] || row.topic}</h5>
        <Badge variant="outline" className="text-[10px]">{diff.label}</Badge>
        {row.favor !== "neutral" && (
          <Badge variant="secondary" className="text-[10px]">
            {row.favor === "v1" ? "Favors V1" : "Favors V2"}
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">V1</p>
          <p className="leading-relaxed">{row.v1Summary}</p>
          {v1Doc && row.v1Citation && row.v1Citation !== "[Not in document]" && (
            <button
              onClick={() => onFocusSource(v1Doc.id, parsePageFromChip(row.v1Citation))}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 hover:underline font-mono"
            >
              {row.v1Citation}
            </button>
          )}
          {row.v1Citation === "[Not in document]" && (
            <span className="mt-1 inline-block text-[11px] text-muted-foreground italic">{row.v1Citation}</span>
          )}
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">V2</p>
          <p className="leading-relaxed">{row.v2Summary}</p>
          {v2Doc && row.v2Citation && row.v2Citation !== "[Not in document]" && (
            <button
              onClick={() => onFocusSource(v2Doc.id, parsePageFromChip(row.v2Citation))}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 hover:underline font-mono"
            >
              {row.v2Citation}
            </button>
          )}
          {row.v2Citation === "[Not in document]" && (
            <span className="mt-1 inline-block text-[11px] text-muted-foreground italic">{row.v2Citation}</span>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed italic">{row.favorRationale}</p>
    </div>
  );
}

function parsePageFromChip(chip: string): number {
  const m = chip.match(/p\.?\s*(\d+)/i) || chip.match(/page\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}
