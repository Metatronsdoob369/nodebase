import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, baseProcedure } from '../init';
import prisma from '@/lib/db';
import { createHash } from 'crypto';

export const terrainRouter = createTRPCRouter({

  // Called by n8n ingestion pipeline when a new pack is ready
  recordIngest: baseProcedure
    .input(z.object({
      domain: z.string(),
      packId: z.string(),
      corpusSize: z.number(),
      canonicalPts: z.number(),
      shatteredPts: z.number(),
      blake2bHash: z.string(),
      sourcePath: z.string(),
      status: z.enum(['pending', 'verified', 'failed']).default('verified'),
      triggeredBy: z.string().default('watched_folder'),
    }))
    .mutation(async ({ input }) => {
      return await prisma.terrainIngest.create({ data: input });
    }),

  // Called by WhiteGlove Harness on every gate decision
  recordGateEvent: baseProcedure
    .input(z.object({
      domain: z.string(),
      queryText: z.string(),
      shatter: z.number(),
      heat: z.number(),
      band: z.string(),
      gateState: z.string(),
      decision: z.string(),
      slopHit: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const queryHash = createHash('sha256')
        .update(input.queryText)
        .digest('hex')
        .slice(0, 16);

      const event = await prisma.gateEvent.create({
        data: {
          domain: input.domain,
          queryHash,
          shatter: input.shatter,
          heat: input.heat,
          band: input.band,
          gateState: input.gateState,
          decision: input.decision,
          slopHit: input.slopHit,
        }
      });

      // Write audit entry for every SILENCE, HOLD, or PROBING decision
      if (['SILENCE', 'HOLD', 'PROBING'].includes(input.decision)) {
        const proofHash = createHash('blake2b512')
          .update(JSON.stringify({ queryHash, shatter: input.shatter, decision: input.decision }))
          .digest('hex')
          .slice(0, 32);

        const entryData = { domain: input.domain, queryHash, shatter: input.shatter, gateDecision: input.decision, spectralProofHash: proofHash, operatorAction: 'pending' };
        const entryHash = createHash('sha256').update(JSON.stringify(entryData)).digest('hex').slice(0, 32);

        await prisma.auditEntry.create({ data: { ...entryData, entryHash } });
      }

      return event;
    }),

  // Query silence events for a domain (for feedback loop)
  getSilenceEvents: protectedProcedure
    .input(z.object({ domain: z.string(), limit: z.number().default(50) }))
    .query(async ({ input }) => {
      return await prisma.gateEvent.findMany({
        where: { domain: input.domain, decision: { in: ['SILENCE', 'HOLD'] } },
        orderBy: { timestamp: 'desc' },
        take: input.limit,
      });
    }),

  // Get audit trail for governance review
  getAuditTrail: protectedProcedure
    .input(z.object({ domain: z.string().optional(), limit: z.number().default(100) }))
    .query(async ({ input }) => {
      return await prisma.auditEntry.findMany({
        where: input.domain ? { domain: input.domain } : undefined,
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });
    }),
});
