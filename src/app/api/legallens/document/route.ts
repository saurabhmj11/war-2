// GET /api/legallens/document?id=...
// Returns the raw PDF bytes (for the in-browser pdf.js viewer with bbox highlight overlay).
// Enforces 24h expiry check.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "upload", "legallens");

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const doc = await db.document.findUnique({ where: { id } });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.expiresAt < new Date()) {
      return NextResponse.json({ error: "Document has expired" }, { status: 410 });
    }
    const fullPath = path.join(UPLOAD_DIR, doc.filePath);
    const buffer = await fs.readFile(fullPath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": doc.fileType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Document-Id": doc.id,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
