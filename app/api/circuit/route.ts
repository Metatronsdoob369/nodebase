import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@/lib/generated/prisma";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sector  = searchParams.get("sector") ?? undefined;
  const source  = searchParams.get("source") ?? undefined;
  const q       = searchParams.get("q") ?? undefined;
  const page    = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit   = Math.min(50, parseInt(searchParams.get("limit") ?? "24"));
  const skip    = (page - 1) * limit;

  const where: any = {};
  if (sector) where.sector = sector;
  if (source) where.source = { contains: source, mode: "insensitive" };
  if (q) {
    where.OR = [
      { title:   { contains: q, mode: "insensitive" } },
      { summary: { contains: q, mode: "insensitive" } },
      { source:  { contains: q, mode: "insensitive" } },
    ];
  }

  const [articles, total, sources] = await Promise.all([
    (prisma as any).circuitArticle.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { ingestedAt: "desc" }],
      skip,
      take: limit,
      select: {
        id: true, title: true, url: true, source: true,
        sector: true, summary: true, author: true,
        publishedAt: true, signalScore: true,
      },
    }),
    (prisma as any).circuitArticle.count({ where }),
    // distinct sources for filter sidebar
    (prisma as any).circuitArticle.groupBy({
      by: ["source"],
      _count: { source: true },
      orderBy: { _count: { source: "desc" } },
    }),
  ]);

  return NextResponse.json({
    articles,
    total,
    page,
    pages: Math.ceil(total / limit),
    sources: sources.map((s: any) => ({ name: s.source, count: s._count.source })),
  }, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
