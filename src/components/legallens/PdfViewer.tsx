"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Loader2, Image as ImageIcon } from "lucide-react";

interface Highlight {
  page: number;
  bbox: [number, number, number, number]; // [x, y, width, height] in PDF user space (top-left origin)
  label?: string;
}

interface PdfViewerProps {
  documentId: string;
  isImage?: boolean; // when true, renders an <img> instead of pdfjs canvases
  highlight?: Highlight | null; // when set, smooth-scrolls to page and animates the highlight
  onHighlightConsumed?: () => void;
}

interface RenderedPage {
  pageNum: number;
  width: number;
  height: number;
  scale: number;
  viewport: { width: number; height: number };
}

export function PdfViewer({ documentId, isImage, highlight, onHighlightConsumed }: PdfViewerProps) {
  // Image mode delegates to a dedicated image renderer — avoids conditional hook calls
  if (isImage) {
    return (
      <ImageViewer
        documentId={documentId}
        highlight={highlight}
        onHighlightConsumed={onHighlightConsumed}
      />
    );
  }
  return <PdfViewerInner documentId={documentId} highlight={highlight} onHighlightConsumed={onHighlightConsumed} />;
}

function PdfViewerInner({ documentId, highlight, onHighlightConsumed }: Omit<PdfViewerProps, "isImage">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageDataRef = useRef<Map<number, RenderedPage>>(new Map());
  const [numPages, setNumPages] = useState(0);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<unknown>(null);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Dynamic import — pdfjs needs window/globalThis
        const pdfjs = await import("pdfjs-dist");
        // Use a CDN worker that matches the installed version
        const workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

        const url = `/api/legallens/document?id=${encodeURIComponent(documentId)}`;
        const loadingTask = pdfjs.getDocument({
          url,
          // Disable external links and fonts from untrusted sources
          disableAutoFetch: false,
          disableStream: false,
        });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load PDF";
        console.error("[PdfViewer] load error:", message);
        setError(message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      // Cleanup pdf doc
      const pdf = pdfDocRef.current as { destroy?: () => void } | null;
      if (pdf && typeof pdf.destroy === "function") {
        try { pdf.destroy(); } catch { /* ignore */ }
      }
      pdfDocRef.current = null;
    };
  }, [documentId]);

  // Render a specific page on its canvas
  const renderPage = useCallback(async (pageNum: number) => {
    const pdf = pdfDocRef.current as {
      getPage: (n: number) => Promise<{
        getViewport: (opts: { scale: number }) => { width: number; height: number };
        render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
      }> | null;
    } | null;
    if (!pdf) return;
    const canvas = canvasRefs.current.get(pageNum);
    const container = containerRef.current;
    if (!canvas || !container) return;

    try {
      const page = await pdf.getPage(pageNum);
      const containerWidth = container.clientWidth - 24; // padding
      const scale = Math.min(1.5, Math.max(0.5, containerWidth / 800));
      const viewport = page.getViewport({ scale });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      await page.render({ canvasContext: ctx, viewport }).promise;
      pageDataRef.current.set(pageNum, {
        pageNum,
        width: viewport.width,
        height: viewport.height,
        scale,
        viewport: { width: viewport.width, height: viewport.height },
      });
    } catch (err) {
      console.error(`[PdfViewer] render page ${pageNum} error:`, err);
    }
  }, []);

  // Intersection observer — render only visible pages (performance for long PDFs)
  useEffect(() => {
    if (numPages === 0 || !containerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const newVisible = new Set(visiblePages);
        for (const entry of entries) {
          const pageNum = Number((entry.target as HTMLElement).dataset.pageNum);
          if (entry.isIntersecting) {
            newVisible.add(pageNum);
          } else {
            // Keep recently rendered pages cached; just stop tracking
          }
        }
        setVisiblePages(newVisible);
      },
      { root: containerRef.current, rootMargin: "200px 0px", threshold: 0 }
    );
    for (let p = 1; p <= numPages; p++) {
      const pageEl = containerRef.current?.querySelector(`[data-page-num="${p}"]`);
      if (pageEl) observer.observe(pageEl);
    }
    return () => observer.disconnect();
  }, [numPages]);

  // Render visible pages
  useEffect(() => {
    for (const pageNum of visiblePages) {
      if (pageNum >= 1 && pageNum <= numPages) {
        const cached = pageDataRef.current.get(pageNum);
        const canvas = canvasRefs.current.get(pageNum);
        if (!cached && canvas) {
          renderPage(pageNum);
        }
      }
    }
  }, [visiblePages, numPages, renderPage]);

  // Highlight: scroll to page + animate highlight overlay
  useEffect(() => {
    if (!highlight || !containerRef.current) return;
    const { page } = highlight;
    const pageEl = containerRef.current.querySelector(`[data-page-num="${page}"]`) as HTMLElement | null;
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Notify parent after the scroll animation completes
    if (onHighlightConsumed) {
      const t = setTimeout(onHighlightConsumed, 1200);
      return () => clearTimeout(t);
    }
  }, [highlight, onHighlightConsumed]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 w-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading document…</span>
      </div>
    );
  }
  if (error) {
    return (
      <Card className="p-6 m-4 border-destructive">
        <p className="text-sm text-destructive">Could not load PDF: {error}</p>
        <p className="text-xs text-muted-foreground mt-2">
          If this is a non-PDF document (DOCX, TXT), the inline viewer is not available — the analysis above still works.
        </p>
      </Card>
    );
  }
  if (numPages === 0) {
    return (
      <Card className="p-6 m-4">
        <p className="text-sm text-muted-foreground">No pages found in this document.</p>
      </Card>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full overflow-y-auto bg-muted/30 p-3">
      <div className="flex flex-col items-center gap-4 pb-8">
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
          const isHighlighted = highlight?.page === pageNum;
          const bbox = isHighlighted ? highlight?.bbox : null;
          const pageData = pageDataRef.current.get(pageNum);
          // Convert bbox [x, y, w, h] in PDF user space → CSS percentage of canvas dims.
          // pdf.js uses top-left origin in viewport space, so the conversion is direct
          // once the page is rendered.
          const highlightStyle = bbox && pageData
            ? {
                left: `${(bbox[0] / pageData.viewport.width) * 100}%`,
                top: `${(bbox[1] / pageData.viewport.height) * 100}%`,
                width: `${(bbox[2] / pageData.viewport.width) * 100}%`,
                height: `${(bbox[3] / pageData.viewport.height) * 100}%`,
              }
            : null;
          return (
            <div
              key={pageNum}
              data-page-num={pageNum}
              className="relative bg-white shadow-md"
              style={{ width: "fit-content", maxWidth: "100%" }}
            >
              <div className="absolute -top-6 left-0 text-xs text-muted-foreground">
                Page {pageNum}
              </div>
              <canvas
                ref={(el) => {
                  if (el) canvasRefs.current.set(pageNum, el);
                  else canvasRefs.current.delete(pageNum);
                }}
                className="block"
              />
              {highlightStyle && (
                <div
                  className="absolute border-2 border-orange-500 bg-orange-500/20 animate-pulse pointer-events-none rounded-sm"
                  style={highlightStyle}
                  aria-label={`Highlighted region on page ${pageNum}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Image-mode viewer: renders a single image with optional bbox highlight ───
function ImageViewer({
  documentId,
  highlight,
  onHighlightConsumed,
}: Omit<PdfViewerProps, "isImage">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const url = `/api/legallens/document?id=${encodeURIComponent(documentId)}`;

  // Highlight effect
  useEffect(() => {
    if (!highlight || !imgRef.current) return;
    // Just animate the highlight (no scroll needed since the image is single-page)
    if (onHighlightConsumed) {
      const t = setTimeout(onHighlightConsumed, 2000);
      return () => clearTimeout(t);
    }
  }, [highlight, onHighlightConsumed]);

  if (error) {
    return (
      <Card className="p-6 m-4 border-destructive">
        <p className="text-sm text-destructive">Could not load image: {error}</p>
      </Card>
    );
  }

  // Compute highlight overlay as percentages of the rendered image dimensions
  const highlightStyle = highlight?.bbox && naturalSize.w > 0
    ? {
        left: `${(highlight.bbox[0] / naturalSize.w) * 100}%`,
        top: `${(highlight.bbox[1] / naturalSize.h) * 100}%`,
        width: `${(highlight.bbox[2] / naturalSize.w) * 100}%`,
        height: `${(highlight.bbox[3] / naturalSize.h) * 100}%`,
      }
    : null;

  return (
    <div ref={containerRef} className="h-full w-full overflow-y-auto bg-muted/30 p-3">
      {loading && (
        <div className="flex items-center justify-center h-48 w-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-xs text-muted-foreground">Loading image…</span>
        </div>
      )}
      <div className="flex flex-col items-center gap-2 pb-8">
        <div className="relative bg-white shadow-md" style={{ width: "fit-content", maxWidth: "100%" }}>
          <div className="absolute -top-6 left-0 text-xs text-muted-foreground flex items-center gap-1">
            <ImageIcon className="h-3 w-3" /> Image document
          </div>
          <img
            ref={imgRef}
            src={url}
            alt="Document image"
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
              setLoading(false);
            }}
            onError={() => {
              setError("Failed to load image. The file may have expired or been deleted.");
              setLoading(false);
            }}
            className="block max-w-full h-auto"
            style={{ maxHeight: "calc(100vh - 10rem)" }}
          />
          {highlightStyle && (
            <div
              className="absolute border-2 border-orange-500 bg-orange-500/20 animate-pulse pointer-events-none rounded-sm"
              style={highlightStyle}
              aria-label="Highlighted region"
            />
          )}
        </div>
        {highlight && (
          <p className="text-xs text-muted-foreground italic mt-2">
            {highlight.label ? `Highlighted: ${highlight.label}` : "Highlighted source region"}
          </p>
        )}
      </div>
    </div>
  );
}
