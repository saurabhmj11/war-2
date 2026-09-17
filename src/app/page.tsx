/* eslint-disable */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, ChangeEvent, RefObject, ReactNode } from "react";
import { Upload, FileText, Loader2, AlertTriangle, ShieldCheck, Sparkles, X, MessageCircleQuestion, BookOpen, Scale, Clock, GitCompareArrows, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import dynamic from "next/dynamic";
const PdfViewer = dynamic(() => import("@/components/legallens/PdfViewer").then((mod) => mod.PdfViewer), { ssr: false });
const CompareDialog = dynamic(() => import("@/components/legallens/CompareDialog").then((mod) => mod.CompareDialog), { ssr: false });
import { TrustScoreBadge, PreSigningChecklistCard, MultiAskCard, Dashboard, ImpactAnalysisCard } from "@/components/legallens/Dashboard";
import { toast } from "sonner";
import type { AnalysisResult, DocumentMeta, QaResult, RiskFlag, SummaryBullet, JargonTerm } from "@/lib/legallens/types";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
];

function isImageFile(fileType: string): boolean {
  return fileType.startsWith("image/");
}

export default function Home() {
  const [view, setView] = useState<"upload" | "results" | "dashboard">("upload");
  const [doc, setDoc] = useState<DocumentMeta | null>(null);
  const [allDocs, setAllDocs] = useState<DocumentMeta[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [highlight, setHighlight] = useState<{ page: number; bbox: [number, number, number, number]; label?: string } | null>(null);
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [level, setLevel] = useState<"simpler" | "standard">("standard");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // On mount, check if user has any existing docs and show dashboard if so
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/legallens/list");
        if (res.ok) {
          const data = await res.json();
          if (data.documents && data.documents.length > 0) {
            setAllDocs(data.documents);
            setView("dashboard");
          }
        }
      } catch {}
    })();
  }, []);

  const refreshDocList = useCallback(async () => {
    try {
      const res = await fetch("/api/legallens/list");
      if (res.ok) {
        const data = await res.json();
        setAllDocs(data.documents || []);
      }
    } catch {}
  }, []);

  // Cleanup on unmount (best-effort)
  useEffect(() => {
    return () => {
      setDoc(null);
      setAnalysis(null);
    };
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error(`File too large. Maximum is 10 MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)} MB.`);
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type) && !file.name.match(/\.(pdf|docx|txt|md)$/i)) {
      toast.error(`Unsupported file type. Accepted: PDF, DOCX, TXT, MD.`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/legallens/upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      const result = await new Promise<DocumentMeta>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (e) { reject(new Error("Invalid server response")); }
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error || `Upload failed (${xhr.status})`));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(formData);
      });

      setDoc(result);
      toast.success("Document uploaded. Now analyzing…");
      setUploading(false);
      setUploadProgress(100);
      await refreshDocList();
      await analyzeDocument(result.id);
    } catch (err) {
      setUploading(false);
      setUploadProgress(0);
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    }
  }, [refreshDocList]);

  const analyzeDocument = useCallback(async (documentId: string, lvl: "simpler" | "standard" = level, lang: "en" | "es" = language) => {
    setAnalyzing(true);
    setView("results");
    try {
      const res = await fetch("/api/legallens/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, level: lvl, language: lang }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error);
      }
      const result: AnalysisResult = await res.json();
      setAnalysis(result);
      toast.success(lang === "es" ? "Análisis completo." : "Analysis complete.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Analysis failed";
      toast.error(msg);
      setView("upload");
    } finally {
      setAnalyzing(false);
    }
  }, [level, language]);

  // Regenerate analysis with current level + language settings
  const regenerateAnalysis = useCallback(async () => {
    if (!doc) return;
    toast.info(language === "es" ? `Regenerando en ${level === "simpler" ? "simple" : "estándar"} · ES…` : `Regenerating in ${level === "simpler" ? "Simpler" : "Standard"} · ${language.toUpperCase()}…`);
    await analyzeDocument(doc.id, level, language);
  }, [doc, level, language, analyzeDocument]);

  // Export current analysis as PDF
  const exportPdf = useCallback(async () => {
    if (!doc) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/legallens/export?documentId=${encodeURIComponent(doc.id)}&language=${language}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `LegalLens-${doc.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [doc, language]);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileInput = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const startNewDocument = useCallback(() => {
    setDoc(null);
    setAnalysis(null);
    setShowPdfViewer(false);
    setHighlight(null);
    setView("upload");
  }, []);

  const showDashboard = useCallback(() => {
    setDoc(null);
    setAnalysis(null);
    setShowPdfViewer(false);
    setHighlight(null);
    refreshDocList();
    setView("dashboard");
  }, [refreshDocList]);

  // Load an already-uploaded document by ID (used by compare-mode source clicks).
  // Fetches the doc meta + latest analysis (without re-running the LLM).
  const loadDocument = useCallback(async (documentId: string): Promise<DocumentMeta | null> => {
    try {
      const [listRes, analysisRes] = await Promise.all([
        fetch("/api/legallens/list").then((r) => r.json() as Promise<{ documents: DocumentMeta[] }>),
        fetch(`/api/legallens/analyze?documentId=${encodeURIComponent(documentId)}`, { method: "GET" }),
      ]);
      const found = listRes.documents.find((d) => d.id === documentId);
      if (!found) {
        toast.error("Document not found. It may have expired.");
        return null;
      }
      setDoc(found);
      if (analysisRes.ok) {
        const analysisData: AnalysisResult = await analysisRes.json();
        setAnalysis(analysisData);
      } else {
        // No cached analysis — re-run it
        await new Promise<void>((resolve) => {
          setAnalyzing(true);
          setView("results");
          fetch("/api/legallens/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documentId }),
          })
            .then((r) => r.json() as Promise<AnalysisResult>)
            .then((result) => { setAnalysis(result); })
            .catch((e) => { toast.error(e instanceof Error ? e.message : "Analysis failed"); })
            .finally(() => { setAnalyzing(false); resolve(); });
        });
      }
      setView("results");
      return found;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load document");
      return null;
    }
  }, []);

  // Compare-mode citation click: switch the main view to the cited document + highlight
  const focusOnSourceFromCompare = useCallback(async (docId: string, page: number, bbox?: [number, number, number, number]) => {
    setCompareOpen(false);
    // If the cited doc is the currently-loaded doc, just update the highlight
    if (doc && doc.id === docId) {
      setShowPdfViewer(true);
      setHighlight({ page, bbox: bbox || [0, 0, 0, 0] });
      return;
    }
    // Otherwise swap the active document
    const loaded = await loadDocument(docId);
    if (loaded) {
      // Slight delay so the PDF viewer mounts with the new docId before we set the highlight
      setTimeout(() => {
        setShowPdfViewer(true);
        setHighlight({ page, bbox: bbox || [0, 0, 0, 0] });
      }, 150);
    }
  }, [doc, loadDocument]);

  // For multi-ask citation clicks: same behavior as compare (may switch active doc)
  const focusOnSourceFromMultiAsk = useCallback(async (docId: string, page: number, bbox?: [number, number, number, number]) => {
    if (doc && doc.id === docId) {
      setShowPdfViewer(true);
      setHighlight({ page, bbox: bbox || [0, 0, 0, 0] });
      return;
    }
    const loaded = await loadDocument(docId);
    if (loaded) {
      setTimeout(() => {
        setShowPdfViewer(true);
        setHighlight({ page, bbox: bbox || [0, 0, 0, 0] });
      }, 150);
    }
  }, [doc, loadDocument]);

  // For pre-signing checklist citation clicks: stays within the current doc
  const focusOnSourceFromChecklist = useCallback((docId: string, page: number, bbox?: [number, number, number, number]) => {
    if (doc && doc.id === docId) {
      setShowPdfViewer(true);
      setHighlight({ page, bbox: bbox || [0, 0, 0, 0] });
    }
  }, [doc]);

  const selectDocFromDashboard = useCallback(async (id: string) => {
    const loaded = await loadDocument(id);
    if (loaded) {
      setShowPdfViewer(false);
      setHighlight(null);
    }
  }, [loadDocument]);

  const focusOnSource = useCallback((page: number, bbox?: [number, number, number, number], label?: string) => {
    if (!bbox) {
      toast.info(`Source is on page ${page}. Open the PDF viewer to see it.`);
      return;
    }
    setShowPdfViewer(true);
    setHighlight({ page, bbox, label });
  }, []);

  // ─── Layout ───
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b sticky top-0 z-30 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-orange-500/90 flex items-center justify-center">
              <Scale className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">LegalLens</h1>
              <p className="text-[10px] text-muted-foreground -mt-1">Understand what you're signing</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(view === "results" || view === "dashboard") && allDocs.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={showDashboard}
                title="View all your documents"
              >
                <FileText className="h-4 w-4 mr-1" /> Dashboard
              </Button>
            )}
            {doc && view === "results" && (
              <>
                <Badge variant="outline" className="text-[10px] font-normal">
                  <Clock className="h-3 w-3 mr-1" />
                  Expires in 24h
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCompareOpen(true)}
                  title="Compare two document versions"
                >
                  <GitCompareArrows className="h-4 w-4 mr-1" /> Compare
                </Button>
                <Button size="sm" variant="ghost" onClick={startNewDocument}>
                  <X className="h-4 w-4 mr-1" /> New
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto max-w-7xl px-4 py-6">
        {view === "upload" && (
          <UploadView
            onFile={handleFile}
            onDrop={handleDrop}
            onPickFile={() => fileInputRef.current?.click()}
            uploading={uploading}
            uploadProgress={uploadProgress}
            fileInputRef={fileInputRef}
            onFileInput={handleFileInput}
          />
        )}
        {view === "dashboard" && (
          <>
            <Dashboard
              documents={allDocs}
              onSelectDoc={selectDocFromDashboard}
              onUploadNew={startNewDocument}
            />
            {allDocs.length > 0 && (
              <MultiAskCard
                documents={allDocs}
                onFocusSource={focusOnSourceFromMultiAsk}
              />
            )}
          </>
        )}
        {view === "results" && doc && (
          <ResultsView
            doc={doc}
            analysis={analysis}
            analyzing={analyzing}
            onShowPdf={() => setShowPdfViewer(true)}
            onFocusSource={focusOnSource}
            showPdfViewer={showPdfViewer}
            highlight={highlight}
            onHighlightConsumed={() => { /* keep last highlight until manually cleared */ }}
            onRegenerate={regenerateAnalysis}
            level={level}
            language={language}
            onLevelChange={setLevel}
            onLanguageChange={setLanguage}
            onExport={exportPdf}
            onChecklistCitationClick={focusOnSourceFromChecklist}
            allDocs={allDocs}
            onMultiAskFocusSource={focusOnSourceFromMultiAsk}
          />
        )}
      </main>

      <CompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        currentDocId={doc?.id || null}
        currentDocName={doc?.fileName || null}
        onFocusSource={focusOnSourceFromCompare}
      />

      <footer className="border-t mt-auto">
        <div className="container mx-auto max-w-7xl px-4 py-4 text-center text-xs text-muted-foreground">
          <p>
            <ShieldCheck className="inline h-3 w-3 mr-1" />
            LegalLens is not a lawyer and does not give legal advice. Built for the "AI for Legal Assistance & Access" challenge. Documents auto-delete after 24 hours. We never train on your data.
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─── Upload View ───
const UploadView = React.memo(({
  onFile, onDrop, onPickFile, uploading, uploadProgress, fileInputRef, onFileInput,
}: {
  onFile: (f: File) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onPickFile: () => void;
  uploading: boolean;
  uploadProgress: number;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileInput: (e: ChangeEvent<HTMLInputElement>) => void;
}) => {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="max-w-3xl mx-auto py-8 md:py-16">
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
          Drop a legal document.<br />Get a plain-language summary.
        </h2>
        <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto">
          Leases, NDAs, offer letters, debt-collection notices. Every claim cites the source. Nothing is invented.
        </p>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        className={`
          relative border-2 border-dashed rounded-xl p-8 md:p-12 text-center transition-colors
          ${dragging ? "border-orange-500 bg-orange-500/5" : "border-border hover:border-orange-500/50 hover:bg-muted/30"}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp,.gif,.bmp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,image/jpeg,image/png,image/webp,image/gif,image/bmp"
          capture="environment"
          onChange={onFileInput}
          className="hidden"
        />
        {uploading ? (
          <div className="space-y-3">
            <Loader2 className="h-10 w-10 animate-spin text-orange-500 mx-auto" />
            <p className="text-sm font-medium">Uploading… {uploadProgress}%</p>
            <Progress value={uploadProgress} className="h-2 max-w-md mx-auto" />
          </div>
        ) : (
          <>
            <div className="flex justify-center mb-4">
              <div className="h-14 w-14 rounded-full bg-orange-500/10 flex items-center justify-center">
                <Upload className="h-7 w-7 text-orange-600" />
              </div>
            </div>
            <p className="text-base font-medium mb-1">Drop your document here</p>
            <p className="text-xs text-muted-foreground mb-4">PDF, DOCX, TXT, MD, or photo/scan (JPG, PNG, WebP) — up to 10 MB</p>
            <Button onClick={onPickFile} size="sm">
              <FileText className="h-4 w-4 mr-2" /> Choose a file
            </Button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-8">
        <FeatureCard icon={<Sparkles className="h-4 w-4" />} title="Clickable citations" body="Every claim links to the exact source on the original page." />
        <FeatureCard icon={<ShieldCheck className="h-4 w-4" />} title="Never advice" body="We explain what's there. We never tell you what to do." />
        <FeatureCard icon={<AlertTriangle className="h-4 w-4" />} title="Escalation" body="High-stakes situations (eviction, criminal, custody) get a referral to a real lawyer." />
      </div>

      <p className="text-center text-xs text-muted-foreground mt-8 max-w-lg mx-auto">
        LegalLens does not give legal advice and is not a substitute for an attorney. Documents auto-delete after 24 hours. We never train on your data.
      </p>
    </div>
  );
});

const FeatureCard = React.memo(({ icon, title, body }: { icon: ReactNode; title: string; body: string }) => {
  return (
    <Card className="p-4 bg-card/50">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-7 w-7 rounded bg-orange-500/10 flex items-center justify-center text-orange-600">
          {icon}
        </div>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </Card>
  );
});

// ─── Results View ───
const ResultsView = React.memo(({
  doc, analysis, analyzing, onShowPdf, onFocusSource, showPdfViewer, highlight, onHighlightConsumed,
  onRegenerate, level, language, onLevelChange, onLanguageChange, onExport,
  onChecklistCitationClick, allDocs, onMultiAskFocusSource,
}: {
  doc: DocumentMeta;
  analysis: AnalysisResult | null;
  analyzing: boolean;
  onShowPdf: () => void;
  onFocusSource: (page: number, bbox?: [number, number, number, number], label?: string) => void;
  showPdfViewer: boolean;
  highlight: { page: number; bbox: [number, number, number, number]; label?: string } | null;
  onHighlightConsumed: () => void;
  onRegenerate: () => void;
  level: "simpler" | "standard";
  language: "en" | "es";
  onLevelChange: (l: "simpler" | "standard") => void;
  onLanguageChange: (l: "en" | "es") => void;
  onExport: () => void;
  onChecklistCitationClick: (docId: string, page: number, bbox?: [number, number, number, number]) => void;
  allDocs: DocumentMeta[];
  onMultiAskFocusSource: (docId: string, page: number, bbox?: [number, number, number, number]) => void;
}) => {
  if (analyzing || !analysis) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-orange-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Reading your document…</h2>
        <p className="text-sm text-muted-foreground">
          Extracting text, flagging risks, decoding jargon. This usually takes 15–60 seconds.
        </p>
        <Card className="mt-8 p-6 bg-muted/30">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{doc.fileName}</p>
              <p className="text-xs text-muted-foreground">{(doc.fileSize / 1024 / 1024).toFixed(2)} MB · {doc.pageCount} pages</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Settings toolbar */}
      <SettingsToolbar
        level={level}
        language={language}
        onLevelChange={onLevelChange}
        onLanguageChange={onLanguageChange}
        onRegenerate={onRegenerate}
        onExport={onExport}
        fkGrade={analysis.fleschKincaidGrade}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: analysis */}
        <div className="space-y-6">
          <SummaryTopCard analysis={analysis} doc={doc} onFocusSource={onFocusSource} onShowPdf={onShowPdf} />

          {/* Trust score badge */}
          {analysis.trustScore && (
            <TrustScoreBadge score={analysis.trustScore} />
          )}

          {/* Pre-signing checklist */}
          {analysis.preSigningChecklist && (
            <PreSigningChecklistCard
              documentId={doc.id}
              checklist={analysis.preSigningChecklist}
              onCitationClick={onChecklistCitationClick}
            />
          )}

          {analysis.escalation?.triggered && (
            <EscalationCard
              category={analysis.escalation.category || ""}
              cardText={analysis.escalation.cardText || ""}
              referralLinks={analysis.escalation.referralLinks || []}
            />
          )}

          <RiskFlagsCard flags={analysis.flags} documentId={doc.id} onFocusSource={onFocusSource} />

          <JargonCard jargon={analysis.jargon} />

          <AskAnythingCard documentId={doc.id} onFocusSource={onFocusSource} />

          {/* Multi-doc ask (only shows if 2+ docs) */}
          {allDocs.length > 1 && (
            <MultiAskCard
              documents={allDocs}
              onFocusSource={onMultiAskFocusSource}
            />
          )}
        </div>

        {/* Right column: PDF viewer (toggleable) */}
        <div className="lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
          {showPdfViewer ? (
            <Card className="h-full overflow-hidden flex flex-col">
              <div className="border-b px-4 py-2 flex items-center justify-between bg-muted/30">
                <div className="flex items-center gap-2 text-xs">
                  <FileText className="h-3 w-3" />
                  <span className="font-medium truncate max-w-50">{doc.fileName}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => { /* keep open */ }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex-1 overflow-hidden">
                <PdfViewer documentId={doc.id} isImage={isImageFile(doc.fileType)} highlight={highlight} onHighlightConsumed={onHighlightConsumed} />
              </div>
            </Card>
          ) : (
            <Card className="h-full flex items-center justify-center bg-muted/20">
              <div className="text-center px-6">
                <FileText className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-medium mb-1">Original document</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Click any citation chip to open the source page with the highlighted region.
                </p>
                <Button size="sm" variant="outline" onClick={onShowPdf}>
                  <FileText className="h-4 w-4 mr-1" /> Open PDF viewer
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
});

const SettingsToolbar = React.memo(({
  level, language, onLevelChange, onLanguageChange, onRegenerate, onExport, fkGrade,
}: {
  level: "simpler" | "standard";
  language: "en" | "es";
  onLevelChange: (l: "simpler" | "standard") => void;
  onLanguageChange: (l: "en" | "es") => void;
  onRegenerate: () => void;
  onExport: () => void;
  fkGrade: number;
}) => {
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Reading level toggle */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground mr-1">Reading level:</span>
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5" role="group" aria-label="Reading Level">
              <button
                aria-label="Set reading level to standard"
                onClick={() => onLevelChange("standard")}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${level === "standard" ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                Standard
              </button>
              <button
                aria-label="Set reading level to simpler"
                onClick={() => onLevelChange("simpler")}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${level === "simpler" ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                Simpler
              </button>
            </div>
          </div>

          {/* Language toggle */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground mr-1">Language:</span>
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5" role="group" aria-label="Language Setting">
              <button
                aria-label="Set language to English"
                onClick={() => onLanguageChange("en")}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${language === "en" ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                EN
              </button>
              <button
                aria-label="Set language to Spanish"
                onClick={() => onLanguageChange("es")}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${language === "es" ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                ES
              </button>
            </div>
          </div>

          {/* FK badge */}
          <Badge variant="outline" className="text-[10px] font-normal">
            FK {(fkGrade ?? 0).toFixed(1)}
            {(fkGrade ?? 0) <= (level === "simpler" ? 6.0 : 8.0) ? " ✓" : " ⚠"}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRegenerate} title="Re-run analysis with current settings">
            <Loader2 className="h-3 w-3 mr-1" /> Regenerate
          </Button>
          <Button size="sm" variant="default" onClick={onExport} title="Download analysis as PDF">
            <FileText className="h-3 w-3 mr-1" /> Export PDF
          </Button>
        </div>
      </div>
    </Card>
  );
});

const SummaryTopCard = React.memo(({
  analysis, doc, onFocusSource, onShowPdf,
}: {
  analysis: AnalysisResult;
  doc: DocumentMeta;
  onFocusSource: (page: number, bbox?: [number, number, number, number]) => void;
  onShowPdf: () => void;
}) => {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardDescription className="text-xs">{doc.fileName} · {doc.pageCount} pages</CardDescription>
            <CardTitle className="text-base mt-1">{analysis.topCardIntro}</CardTitle>
          </div>
          <Badge variant="outline" className="text-[10px]">FK {analysis.fleschKincaidGrade}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <ul className="space-y-2">
          {analysis.summaryBullets.map((b: SummaryBullet, i: number) => (
            <li key={i} className="text-sm leading-relaxed flex gap-2">
              <span className="text-orange-600 font-bold shrink-0">•</span>
              <span className="flex-1">
                {b.text}{" "}
                <CitationChip citation={b.citation} onClick={() => {
                  const page = parsePageFromChip(b.citation);
                  onFocusSource(page, parseBboxFromCitation(b.citation));
                }} />
              </span>
            </li>
          ))}
        </ul>
        <Separator />
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3 w-3 mt-0.5 shrink-0" />
          <p>{analysis.disclaimer}</p>
        </div>
      </CardContent>
    </Card>
  );
});

const RiskFlagsCard = React.memo(({
  flags, documentId, onFocusSource,
}: {
  flags: RiskFlag[];
  documentId: string;
  onFocusSource: (page: number, bbox?: [number, number, number, number], label?: string) => void;
}) => {
  if (!flags || flags.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Risk flags</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">No high-impact clauses found.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Risk flags</CardTitle>
        <CardDescription className="text-xs">
          Click any flag to see the source on the original page. High and medium flags have an expandable impact analysis (fair-version example + financial exposure estimate).
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {flags.map((flag, i) => (
          <RiskFlagRow key={i} flag={flag} documentId={documentId} onFocusSource={onFocusSource} />
        ))}
      </CardContent>
    </Card>
  );
});

function RiskFlagRow({
  flag, documentId, onFocusSource,
}: {
  key?: number;
  flag: RiskFlag;
  documentId: string;
  onFocusSource: (page: number, bbox?: [number, number, number, number], label?: string) => void;
}) {
  const sev = flag.severity;
  const sevColor =
    sev === "high" ? "border-l-red-500 bg-red-500/5" :
    sev === "medium" ? "border-l-amber-500 bg-amber-500/5" :
    "border-l-emerald-500 bg-emerald-500/5";
  const sevDot =
    sev === "high" ? "bg-red-500" :
    sev === "medium" ? "bg-amber-500" :
    "bg-emerald-500";
  return (
    <div className={`border-l-4 ${sevColor} pl-3 py-2 rounded-r-md`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`h-2 w-2 rounded-full ${sevDot}`} aria-hidden />
        <Badge variant="outline" className="text-[10px] font-normal">{flag.severityLabel}</Badge>
        <Badge variant="secondary" className="text-[10px]">{flag.category}</Badge>
      </div>
      <p className="text-sm font-medium mb-1">{flag.plainSummary}</p>
      <p className="text-xs text-muted-foreground leading-relaxed mb-2">{flag.plainTranslation}</p>
      {flag.questionsToAsk.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Questions to ask:</span>
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            {flag.questionsToAsk.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <button
          onClick={() => onFocusSource(flag.sourcePage, flag.sourceBbox, flag.plainSummary)}
          className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 hover:underline"
        >
          <FileText className="h-3 w-3" />
          View source on page {flag.sourcePage} ({flag.sourceClause})
        </button>
        {/* Impact analysis expander — only for high/medium flags */}
        {(flag.severity === "high" || flag.severity === "medium") && (
          <ImpactAnalysisCard
            documentId={documentId}
            flag={{
              severity: flag.severity,
              category: flag.category,
              plainSummary: flag.plainSummary,
              sourceClause: flag.sourceClause,
              sourcePage: flag.sourcePage,
              plainTranslation: flag.plainTranslation,
            }}
          />
        )}
      </div>
    </div>
  );
}

function JargonCard({ jargon }: { jargon: JargonTerm[] }) {
  if (!jargon || jargon.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Jargon decoder</CardTitle>
        </div>
        <CardDescription className="text-xs">Tap any term for a one-line plain definition.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-2">
          {jargon.map((j, i) => (
            <TooltipProvider key={i}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="text-xs cursor-help">{j.term}</Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">{j.plainDefinition}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{j.sourceClause} · p.{j.sourcePage}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AskAnythingCard({
  documentId, onFocusSource,
}: {
  documentId: string;
  onFocusSource: (page: number, bbox?: [number, number, number, number], label?: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QaResult | null>(null);
  const [history, setHistory] = useState<{ q: string; a: QaResult }[]>([]);

  const ask = async () => {
    if (!question.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/legallens/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, question: question.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }
      const data: QaResult = await res.json();
      setResult(data);
      setHistory((h) => [{ q: question.trim(), a: data }, ...h].slice(0, 5));
      setQuestion("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Q&A failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Ask anything</CardTitle>
        </div>
        <CardDescription className="text-xs">Grounded answers — every claim cites the source. Abstention is OK.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
            placeholder="When can the landlord enter? What happens if I'm late?"
            disabled={loading}
            className="text-sm"
          />
          <Button size="sm" onClick={ask} disabled={loading || !question.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ask"}
          </Button>
        </div>

        {result && (
          <QaResultView result={result} onFocusSource={onFocusSource} />
        )}

        {history.length > 0 && (
          <div className="space-y-2 mt-2">
            <p className="text-xs text-muted-foreground">Previous questions:</p>
            {history.map((h, i) => (
              <details key={i} className="text-xs">
                <summary className="cursor-pointer hover:underline">{h.q}</summary>
                <QaResultView result={h.a} onFocusSource={onFocusSource} compact />
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QaResultView({
  result, onFocusSource, compact,
}: {
  result: QaResult;
  onFocusSource: (page: number, bbox?: [number, number, number, number], label?: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-md border bg-muted/30 ${compact ? "p-2 mt-1" : "p-3"} space-y-2`}>
      {!result.inDocument && (
        <div className="flex items-center gap-2 text-xs text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          <span>Not in your document.</span>
        </div>
      )}
      <p className="text-sm leading-relaxed">{result.answer}</p>
      {result.citations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.citations.map((c, i) => (
            <CitationChip
              key={i}
              citation={c.chip}
              onClick={() => onFocusSource(c.page, c.bbox)}
            />
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

function CitationChip({
  citation, onClick,
}: {
  key?: number;
  citation: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/10 hover:bg-orange-500/20 text-orange-700 text-[11px] font-mono transition-colors"
    >
      {citation}
    </button>
  );
}

function EscalationCard({
  category, cardText, referralLinks,
}: {
  category: string;
  cardText: string;
  referralLinks: { label: string; url: string }[];
}) {
  return (
    <Card className="border-amber-500/50 bg-amber-500/5">
      <CardContent className="pt-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900 mb-1">
              {category === "eviction" ? "Eviction notice" :
               category === "criminal" ? "Criminal matter" :
               category === "custody_divorce" ? "Family court matter" :
               category === "immigration" ? "Immigration matter" :
               category === "being_sued" ? "You're being sued" :
               category === "response_deadline" ? "Response deadline" :
               category === "fraud_coercion" ? "Possible fraud or coercion" :
               "Talk to a professional"}
            </p>
            <p className="text-sm text-amber-800 mb-3">{cardText}</p>
            {referralLinks.length > 0 && (
              <div className="flex flex-col gap-1">
                {referralLinks.map((r, i) => (
                  <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                     className="text-xs text-amber-700 hover:text-amber-900 hover:underline">
                    → {r.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ───
function parsePageFromChip(chip: string): number {
  // Match "p.N" or "page N" in chip
  const m = chip.match(/p\.?\s*(\d+)/i) || chip.match(/page\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}
function parseBboxFromCitation(_citation: string): [number, number, number, number] | undefined {
  // In production, the analysis result carries the bbox; for summary bullets without
  // explicit bbox, we return undefined and the UI surfaces the page without a highlight.
  return undefined;
}
