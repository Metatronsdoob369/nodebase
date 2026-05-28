import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { normalizeTerrainPayload } from "@/lib/terrain/transform";

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();

    // Stage 1: Transform — normalize raw payload to canonical shape
    const normalized = normalizeTerrainPayload(raw);

    // Stage 2: Ingest — write canonical record to terrain_ingest
    const entry = await prisma.terrainIngest.create({
      data: {
        packId:       normalized.packId,
        domain:       normalized.domain,
        source:       normalized.source,
        corpusSize:   normalized.corpusSize,
        canonicalPts: normalized.canonicalPts,
        shatteredPts: normalized.shatteredPts,
        blake2bHash:  normalized.blake2bHash,
        sourcePath:   normalized.sourcePath,
        payload:      normalized.payload,
        status:       "ingested",
        triggeredBy:  "webhook",
      },
    });

    return NextResponse.json({
      ok:     true,
      id:     entry.id,
      packId: normalized.packId,
      domain: normalized.domain ?? null,
      status: "ingested",
    });
  } catch (err: any) {
    console.error("[webhook/ingest]", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
