import { NextResponse } from "next/server";
import { PrismaClient } from "@/lib/generated/prisma";

const prisma = new PrismaClient();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  const runs = await prisma.signalRun.findMany({
    where: {
      sector: { not: { endsWith: "-crossover" } },
    },
    orderBy: { runAt: "desc" },
    take: 1,
    select: {
      id: true,
      sector: true,
      analysis: true,
      sceneImageUrl: true,
      status: true,
      itemCount: true,
      nodeCount: true,
      runAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ runs }, { headers: CORS });
}
