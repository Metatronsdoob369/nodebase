import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { execute } from "@/inngest/functions";
import { sarnSignalRun, sarnCrossoverRun, sarnCircadianPrune } from "@/inngest/sarn-signal";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    execute,
    sarnSignalRun,
    sarnCrossoverRun,
    sarnCircadianPrune,
  ],
});
