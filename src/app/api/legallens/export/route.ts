// GET /api/legallens/export?documentId=...&language=en
// Renders the latest analysis for a document as a downloadable PDF using pdfkit.
// Covers PRD US-7 (Export) and FR-12 Should-tier.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DISCLAIMER_TEXT } from "@/lib/legallens/system-prompt";
import type { AnalysisResult } from "@/lib/legallens/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const ACCENT = "#D4875A";
const PRIMARY = "#1A2330";
const MUTED = "#687078";
const HIGH_COLOR = "#DC2626";
const MED_COLOR = "#D97706";
const NOTE_COLOR = "#10B981";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get("documentId");
    const language = (searchParams.get("language") || "en") as "en" | "es";
    if (!documentId) {
      return NextResponse.json({ error: "Missing documentId" }, { status: 400 });
    }
    const doc = await db.document.findUnique({ where: { id: documentId } });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (doc.expiresAt < new Date()) return NextResponse.json({ error: "Document has expired" }, { status: 410 });

    const analysisRow = await db.analysis.findFirst({
      where: { documentId },
      orderBy: { createdAt: "desc" },
    });
    if (!analysisRow) {
      return NextResponse.json({ error: "No analysis found. Run analysis first." }, { status: 404 });
    }

    const summary = JSON.parse(analysisRow.summaryJson);
    const flags = JSON.parse(analysisRow.flagsJson);
    const jargon = JSON.parse(analysisRow.jargonJson);
    const analysis: AnalysisResult = { ...summary, flags, jargon, disclaimer: DISCLAIMER_TEXT } as AnalysisResult;

    const PDFKit = (await import("pdfkit")).default;
    const chunks: Buffer[] = [];
    const pdf: any = new PDFKit({
      size: "LETTER",
      margin: 50,
      info: {
        Title: `LegalLens Analysis - ${doc.fileName}`,
        Author: "LegalLens",
        Subject: "Plain-language document analysis",
        Creator: "LegalLens v1.1",
      },
    });

    pdf.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    const endPromise = new Promise<Buffer>((resolve) => {
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
    });

    // Page footer on every page
    pdf.on("pageAdded", () => { /* no-op, footer added via range below */ });

    // ─── Page 1: Cover ───
    pdf.rect(0, 0, pdf.page.width, 280).fill(PRIMARY);
    pdf.rect(0, 280, pdf.page.width, 4).fill(ACCENT);

    pdf.fillColor(ACCENT).font("Helvetica-Bold").fontSize(9);
    pdf.text("L  E  G  A  L  L  E  N  S", 50, 60);

    pdf.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(26);
    pdf.text("Document Analysis", 50, 90);

    pdf.fillColor("#B0B8C0").font("Helvetica").fontSize(12);
    pdf.text(language === "es" ? "Resumen en lenguaje sencillo" : "Plain-language summary with risk flags", 50, 125);

    pdf.fillColor(MUTED).font("Helvetica").fontSize(10);
    let metaY = 320;
    const metaLines = [
      `File: ${doc.fileName}`,
      `Size: ${(doc.fileSize / 1024).toFixed(1)} KB`,
      `Pages: ${doc.pageCount}`,
      `Generated: ${new Date().toLocaleString()}`,
      `Expires: ${new Date(doc.expiresAt).toLocaleString()}`,
      `Document type: ${analysis.documentType || "Unknown"}`,
    ];
    for (const line of metaLines) {
      pdf.text(line, 50, metaY);
      metaY += 16;
    }

    // Footer
    drawFooter(pdf, 1, language);

    // ─── Page 2: Summary + Disclaimer ───
    pdf.addPage();
    pdf.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(16);
    pdf.text(language === "es" ? "Resumen" : "Summary", 50, 60);

    pdf.fillColor(MUTED).font("Helvetica-Oblique").fontSize(11);
    pdf.text(analysis.topCardIntro, 50, 90, { width: pdf.page.width - 100 });

    pdf.moveDown(1);
    pdf.fillColor(PRIMARY).font("Helvetica").fontSize(11);
    for (const bullet of analysis.summaryBullets || []) {
      pdf.text(`\u2022  ${bullet.text}  ${bullet.citation}`, {
        width: pdf.page.width - 100,
        align: "left",
        paragraphGap: 6,
      });
    }

    pdf.moveDown(1);
    pdf.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9);
    pdf.text(analysis.disclaimer, { width: pdf.page.width - 100, align: "left", paragraphGap: 4 });

    drawFooter(pdf, 2, language);

    // ─── Page 3+: Risk flags ───
    if (analysis.flags && analysis.flags.length > 0) {
      pdf.addPage();
      pdf.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(16);
      pdf.text(language === "es" ? "Banderas de riesgo" : "Risk flags", 50, 60);

      let y = 100;
      const pageBottom = pdf.page.height - 80;

      for (const flag of analysis.flags) {
        if (y > pageBottom - 100) {
          drawFooter(pdf, 0, language); // we don't know page number easily here
          pdf.addPage();
          y = 60;
        }
        const sevColor =
          flag.severity === "high" ? HIGH_COLOR :
          flag.severity === "medium" ? MED_COLOR :
          NOTE_COLOR;
        // Severity bar
        pdf.rect(50, y, 4, 16).fill(sevColor);
        pdf.fillColor(sevColor).font("Helvetica-Bold").fontSize(10);
        pdf.text(flag.severityLabel, 62, y + 2, { continued: true, width: 200 });
        pdf.fillColor(MUTED).font("Helvetica").fontSize(9);
        pdf.text(`  ·  ${flag.category}`);
        y += 22;

        pdf.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(11);
        pdf.text(flag.plainSummary, 62, y, { width: pdf.page.width - 124 });
        y += 22;

        pdf.fillColor("#333333").font("Helvetica").fontSize(10);
        pdf.text(flag.plainTranslation, 62, y, { width: pdf.page.width - 124 });
        y += 28;

        pdf.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9);
        pdf.text(`Source: ${flag.sourceClause}, page ${flag.sourcePage}`, 62, y, { width: pdf.page.width - 124 });
        y += 18;

        if (flag.questionsToAsk && flag.questionsToAsk.length > 0) {
          pdf.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(9);
          pdf.text(language === "es" ? "Preguntas para hacer:" : "Questions to ask:", 62, y, { width: pdf.page.width - 124 });
          y += 14;
          pdf.fillColor("#444444").font("Helvetica").fontSize(9);
          for (const q of flag.questionsToAsk) {
            pdf.text(`  \u2022  ${q}`, 62, y, { width: pdf.page.width - 124 });
            y += 12;
          }
        }
        y += 14;
        pdf.moveTo(50, y).lineTo(pdf.page.width - 50, y).lineWidth(0.5).stroke("#E0E0E0");
        y += 16;
      }
      drawFooter(pdf, 0, language);
    }

    // ─── Final page: Jargon ───
    if (analysis.jargon && analysis.jargon.length > 0) {
      pdf.addPage();
      pdf.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(16);
      pdf.text(language === "es" ? "Decodificador de jerga" : "Jargon decoder", 50, 60);

      let y = 100;
      pdf.font("Helvetica").fontSize(10);
      for (const term of analysis.jargon) {
        if (y > pdf.page.height - 80) {
          drawFooter(pdf, 0, language);
          pdf.addPage();
          y = 60;
        }
        pdf.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(10);
        pdf.text(term.term, 50, y, { width: pdf.page.width - 100, continued: true });
        pdf.fillColor(MUTED).font("Helvetica").fontSize(9);
        pdf.text(`  (p.${term.sourcePage})`);
        y += 16;
        pdf.fillColor("#333333").font("Helvetica").fontSize(10);
        pdf.text(term.plainDefinition, 50, y, { width: pdf.page.width - 100 });
        y += 24;
      }
      drawFooter(pdf, 0, language);
    }

    pdf.end();
    const pdfBuffer = await endPromise;

    const safeFileName = doc.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "");
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="LegalLens-${safeFileName}.pdf"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[export] error:", message);
    return NextResponse.json({ error: `Export failed: ${message}` }, { status: 500 });
  }
}

function drawFooter(pdf: any, _pageNum: number, language: "en" | "es") {
  const range = pdf.buffer?.pageRange;
  void range; // pdfkit page numbering is complex; we render a static footer
  const bottom = pdf.page.height - 50;
  pdf.fillColor(MUTED).font("Helvetica").fontSize(8);
  pdf.text(
    language === "es"
      ? "LegalLens no es un abogado y no ofrece asesoramiento legal. Los documentos se eliminan después de 24 horas."
      : "LegalLens is not a lawyer and does not give legal advice. Documents auto-delete after 24 hours.",
    50,
    bottom,
    { width: pdf.page.width - 100, align: "center" }
  );
}
