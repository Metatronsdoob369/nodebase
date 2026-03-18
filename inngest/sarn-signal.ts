import { spawn } from "child_process";
import { inngest } from "./client";
import { PrismaClient } from "@/lib/generated/prisma";

const prisma = new PrismaClient();

// Call xAI directly via fetch — avoids AI SDK Responses API incompatibility
async function callGrok(prompt: string, system: string): Promise<string> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-3-fast",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      max_tokens: 800,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`xAI error ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return data.choices[0].message.content;
}

const GAT_SCRIPT = "/Users/joewales/NODE_OUT_Master/torcs-mcp/gat_example.py";

// Run the GAT compression script, return stdout as string
function runGatScript(
  sector: string,
  mode: "signal" | "crossover" = "signal"
): Promise<{ map: string; itemCount: number; nodeCount: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "conda",
      ["run", "-n", "agents", "python", GAT_SCRIPT, "--no-grok", "--sector", sector, "--mode", mode],
      {
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`GAT script exited ${code}: ${stderr.slice(0, 400)}`));
        return;
      }

      // Parse item/node counts from the status lines printed before the map
      const itemMatch = stdout.match(/(\d+) articles loaded/);
      const nodeMatch = stdout.match(/Graph nodes: (\d+)/);

      resolve({
        map: stdout,
        itemCount: itemMatch ? parseInt(itemMatch[1]) : 0,
        nodeCount: nodeMatch ? parseInt(nodeMatch[1]) : 0,
      });
    });

    proc.on("error", (e) => reject(new Error(`Failed to spawn: ${e.message}`)));

    // 3-minute timeout — GAT is fast, Grok is on our side
    setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("GAT script timed out after 3 minutes"));
    }, 180_000);
  });
}

export const sarnCrossoverRun = inngest.createFunction(
  {
    id: "sarn-crossover-run",
    name: "SARN — Crossover Brief",
    retries: 2,
  },
  [
    { event: "sarn/crossover.run" },
    { cron: "0 8 * * *" }, // daily at 8am — one editorial brief per morning
  ],
  async ({ event, step }) => {
    const sector = (event as any).data?.sector ?? "racing";

    // Step 1: Build crossover map (no-grok, full feed, cultural universe)
    const gat = await step.run("gat-crossover-map", () =>
      runGatScript(sector, "crossover")
    );

    // Step 2: Grok finds the entendre bridges
    const analysis = await step.run("grok-crossover-brief", () => {
      const res = fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.XAI_API_KEY}`,
          "User-Agent": "SARN-GAT/1.0",
        },
        body: JSON.stringify({
          model: "grok-3-fast",
          messages: [
            {
              role: "user",
              content: `${gat.map}\n\nYou are SARN's crossover content strategist. SARN is a speed culture publication.\n\nYou have two columns above: THE RACING WORLD and THE CULTURAL UNIVERSE. The readers in both columns are the same people. They sim race AND they game, watch anime, follow tech drops.\n\nFind the 3 best bridge opportunities and write article titles with DUAL MEANING.\n\nA great crossover title:\n- Works as a standalone story in BOTH worlds\n- Uses the outsider's language as a racing metaphor — or vice versa\n- Has mystery or tension that makes both audiences feel it's written for them\n- Doesn't telegraph the bait\n\nFor each of the 3 best bridge nodes:\n**[BRIDGE NODE: name]**\n- Why this works: one sentence on the audience overlap\n- Racing metaphor: what does this outsider topic map to in racing?\n- Title Option A: [play on outsider narrative, racing subtext]\n- Title Option B: [play on racing narrative, outsider subtext]\n- Title Option C: [pure entendre — neither world named explicitly]\n- Best pick: which title and why\n\nBe ruthless. Only bring the ones that make you feel something.`,
            },
          ],
          max_tokens: 1200,
          temperature: 0.9,
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`xAI error ${r.status}: ${await r.text()}`);
        const d = await r.json() as any;
        return d.choices[0].message.content as string;
      });
      return res;
    });

    // Step 3: Store — sector tagged as "racing-crossover" to separate from signal runs
    const record = await step.run("store-crossover", () =>
      prisma.signalRun.create({
        data: {
          sector: `${sector}-crossover`,
          signalMap: gat.map,
          analysis,
          itemCount: gat.itemCount,
          nodeCount: gat.nodeCount,
        },
      })
    );

    return {
      id: record.id,
      sector: `${sector}-crossover`,
      itemCount: gat.itemCount,
      nodeCount: gat.nodeCount,
      preview: analysis.slice(0, 280),
    };
  }
);

export const sarnSignalRun = inngest.createFunction(
  {
    id: "sarn-signal-run",
    name: "SARN — Signal Run",
    retries: 2,
  },
  [
    { event: "sarn/signal.run" },
    { cron: "0 */6 * * *" }, // every 6 hours
  ],
  async ({ event, step }) => {
    const sector = (event as any).data?.sector ?? "racing";

    // ── Step 1: GAT compression ──────────────────────────────────────────────
    const gat = await step.run("gat-compress", () => runGatScript(sector));

    // ── Step 2: Grok editorial analysis ─────────────────────────────────────
    const analysis = await step.run("grok-analysis", () =>
      callGrok(
        `Sector: ${sector.toUpperCase()}\n\n${gat.map}\n\nYou are reading the live signal map of the ${sector} community right now. Give me editorial intelligence:\n\n**ARTICLE LEAD:** Write the title and one-sentence hook for the article SARN should publish today. Make it specific to what this signal map actually shows — not a generic racing headline.\n\n**SIGNAL BREAKDOWN:**\n- What's the strongest story in this data? (name it, cite the nodes)\n- What's the dark horse signal — strong graph weight but not obvious?\n- What does this community actually care about this week that isn't the obvious answer?\n\n**EDITORIAL CALL:** One paragraph. What's the cultural moment here? What would a sharp editor see in this data that a casual reader would miss?\n\nBe specific. Cite actual nodes and scores. No boilerplate. This is for a publication, not a report.`,
        "You are SARN's signal editor. You read compressed signal maps and produce sharp, specific editorial intelligence for a speed culture publication. Every analysis should feel like a different story because it IS a different day. Cite specific nodes. Name specific tensions. Be a journalist, not a summariser."
      )
    );

    // ── Step 3: Persist ──────────────────────────────────────────────────────
    const record = await step.run("store-result", () =>
      prisma.signalRun.create({
        data: {
          sector,
          signalMap: gat.map,
          analysis,
          itemCount: gat.itemCount,
          nodeCount: gat.nodeCount,
        },
      })
    );

    return {
      id: record.id,
      sector,
      itemCount: gat.itemCount,
      nodeCount: gat.nodeCount,
      preview: analysis.slice(0, 280),
    };
  }
);
