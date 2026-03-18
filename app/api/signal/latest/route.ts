import { NextResponse } from "next/server";
import { PrismaClient } from "@/lib/generated/prisma";

const prisma = new PrismaClient();

export async function GET() {
  const runs = await prisma.signalRun.findMany({
    where: {
      sector: { not: { endsWith: "-crossover" } },
    },
    orderBy: { runAt: "desc" },
    take: 10,
    select: {
      id: true,
      sector: true,
      analysis: true,
      itemCount: true,
      nodeCount: true,
      runAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ runs });
}
