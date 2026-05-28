import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workflowId = searchParams.get("workflowId");

  if (!workflowId) {
    return NextResponse.json({ ok: false, error: "workflowId required" }, { status: 400 });
  }

  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: {
      nodes: {
        include: {
          outputConnections: true,
        },
      },
    },
  });

  if (!workflow) {
    return NextResponse.json({ ok: false, error: "workflow not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    topology: {
      workflowId: workflow.id,
      name: workflow.name,
      nodes: workflow.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name,
        position: n.position,
        data: n.data,
        connections: n.outputConnections.map((c) => ({
          toNodeId: c.toNodeId,
          fromOutput: c.fromOutput,
          toInput: c.toInput,
        })),
      })),
      exportedAt: new Date().toISOString(),
    },
  });
}
