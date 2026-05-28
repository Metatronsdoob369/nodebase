/**
 * Normalizes a raw webhook payload into the canonical TerrainIngest shape.
 * All fields are optional at input — the transform fills defaults and
 * extracts known keys from common Terrain Pack manifest structures.
 */
export interface TerrainIngestPayload {
  packId: string;
  domain?: string;
  source?: string;
  corpusSize?: number;
  canonicalPts?: number;
  shatteredPts?: number;
  blake2bHash?: string;
  sourcePath?: string;
  payload?: Record<string, unknown>;
}

export function normalizeTerrainPayload(
  raw: Record<string, unknown>
): TerrainIngestPayload {
  return {
    packId:       String(raw.packId ?? raw.pack_id ?? raw.id ?? "unknown"),
    domain:       raw.domain       ? String(raw.domain)       : undefined,
    source:       raw.source       ? String(raw.source)       : "webhook",
    corpusSize:   raw.corpusSize   ? Number(raw.corpusSize)   :
                  raw.corpus_size  ? Number(raw.corpus_size)  : undefined,
    canonicalPts: raw.canonicalPts ? Number(raw.canonicalPts) :
                  raw.canonical_pts ? Number(raw.canonical_pts) : undefined,
    shatteredPts: raw.shatteredPts ? Number(raw.shatteredPts) :
                  raw.shattered_pts ? Number(raw.shattered_pts) : undefined,
    blake2bHash:  raw.blake2bHash  ? String(raw.blake2bHash)  :
                  raw.blake2b_hash ? String(raw.blake2b_hash) : undefined,
    sourcePath:   raw.sourcePath   ? String(raw.sourcePath)   :
                  raw.source_path  ? String(raw.source_path)  : undefined,
    payload:      raw as Record<string, unknown>,
  };
}
