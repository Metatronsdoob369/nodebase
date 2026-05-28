import { createTRPCRouter } from '../init';
import { workFlowRouter } from '@/features/workflows/server/routers';
import { terrainRouter } from './terrain';

export const appRouter = createTRPCRouter({
    workflows: workFlowRouter,
    terrain: terrainRouter,
});

export type AppRouter = typeof appRouter;
