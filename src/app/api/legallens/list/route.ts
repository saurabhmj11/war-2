// GET /api/legallens/list
// Returns all non-expired documents (for the compare-mode UI picker).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const docs = await db.document.findMany({
      where: { expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, fileName: true, fileSize: true, fileType: true,
        pageCount: true, textPreview: true, status: true,
        createdAt: true, expiresAt: true,
      },
      take: 50,
    });
    return NextResponse.json(
      {
        documents: docs.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          expiresAt: d.expiresAt.toISOString(),
        })),
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
