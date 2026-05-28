~/nodebase/features/workflows/server/routers.ts << 'EOF'
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { generateSlug } from "random-word-slugs";
import { z } from "zod";
import prisma from "@/lib/db";
import { PAGINATION } from "@/config/constants";
import { Node, Edge } from "@xyflow/react";
import { NodeType } from "@/lib/generated/prisma";

export const workFlowRouter = createTRPCRouter({
  create: protectedProcedure.mutation(({ ctx }) => {
    return prisma.workflow.create({
      data: {
        name: generateSlug(3),
        userId: ctx.auth.user.id,
        nodes: {
          create: {
            type: NodeType.INITIAL,
            position: { x: 0, y: 0 },
            name: NodeType.INITIAL,
          },
        },
      },
    });
  }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return prisma.workflow.delete({
        where: { userId: ctx.auth.user.id, id: input.id },
      });
    }),

  updateName: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      return prisma.workflow.update({
        where: { userId: ctx.auth.user.id, id: input.id },
        data: { name: input.name },
      });
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      nodes: z.array(z.object({
        id: z.string(),
        type: z.string().nullish(),
        position: z.object({ x: z.number(), y: z.number() }),
        data: z.record(z.string(), z.any()).optional(),
      })),
      edges: z.array(z.object({
        source: z.string(),
        target: z.string(),
        sourceHandle: z.string().nullish(),
        targetHandle: z.string().nullish(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, nodes, edges } = input;

      await prisma.workflow.findUniqueOrThrow({
        where: { id, userId: ctx.auth.user.id },
      });

      return prisma.$transaction(async (tx) => {
        const incomingNodeIds = nodes.map((n) => n.id);

        // Differential purge: only evict nodes removed from incoming payload
        await tx.node.deleteMany({
          where: { workflowId: id, id: { notIn: incomingNodeIds } },
        });

        // Upsert remaining topology — no destructive identity thrashing
        for (const node of nodes) {
          await tx.node.upsert({
            where: { id: node.id },
            update: {
              position: node.position,
              data: node.data || {},
              name: node.type || "node-instance",
            },
            create: {
              id: node.id,
              type: (node.type as NodeType) || NodeType.INITIAL,
              position: node.position,
              data: node.data || {},
              name: node.type || "node-instance",
              workflowId: id,
            },
          });
        }

        // Connections change topology frequently — safe to flush and recreate
        // NOTE: Connection schema uses 'workflow' (String), not 'workflowId'
        await tx.connection.deleteMany({ where: { workflow: id } });

        if (edges.length > 0) {
          await tx.connection.createMany({
            data: edges.map((edge) => ({
              workflow: id,
              fromNodeId: edge.source,
              toNodeId: edge.target,
              fromOutput: edge.sourceHandle || "main",
              toInput: edge.targetHandle || "main",
            })),
          });
        }

        return await tx.workflow.update({
          where: { id },
          data: { updatedAt: new Date() },
        });
      });
    }),

  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: { id: input.id, userId: ctx.auth.user.id },
        include: { nodes: true, connections: true },
      });

      const nodes: Node[] = workflow.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position as { x: number; y: number },
        data: (node.data as Record<string, unknown>) || {},
      }));

      const edges: Edge[] = workflow.connections.map((connection) => ({
        id: connection.id,
        source: connection.fromNodeId,
        target: connection.toNodeId,
        sourceHandle: connection.fromOutput,
        targetHandle: connection.toInput,
      }));

      return { id: workflow.id, name: workflow.name, nodes, edges };
    }),

  getMany: protectedProcedure
    .input(z.object({
      page: z.number().default(PAGINATION.DEFAULT_PAGE),
      pageSize: z.number().min(PAGINATION.MIN_PAGE_SIZE).max(PAGINATION.MAX_PAGE_SIZE).default(PAGINATION.DEFAULT_PAGE_SIZE),
      search: z.string().default(""),
    }))
    .query(async ({ ctx, input }) => {
      const { page, pageSize, search } = input;
      const [items, totalCount] = await Promise.all([
        prisma.workflow.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
          where: { userId: ctx.auth.user.id, name: { contains: search, mode: "insensitive" } },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.workflow.count({
          where: { userId: ctx.auth.user.id, name: { contains: search, mode: "insensitive" } },
        }),
      ]);
      const totalPages = Math.ceil(totalCount / pageSize);
      return { items, page, pageSize, totalCount, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
    }),
});
EOF
