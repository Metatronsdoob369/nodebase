import { spawn } from "child_process";
import { writeFile, readFile } from "fs/promises";
import { put } from "@vercel/blob";
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
    if (process.env.VERCEL) {
      return { skipped: true, reason: "local-only — run via Inngest dev server" };
    }

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
    // These functions spawn local processes (conda/Python GAT, sqlite3, file writes).
    // They only work when the Inngest dev server is running locally.
    // On Vercel cloud deployments, bail out cleanly instead of failing.
    if (process.env.VERCEL) {
      return { skipped: true, reason: "local-only — run via Inngest dev server" };
    }

    const sector = (event as any).data?.sector ?? "racing";
    const topic  = (event as any).data?.topic  ?? null;  // optional editorial brief

    // ── Step 1: GAT compression ──────────────────────────────────────────────
    const gat = await step.run("gat-compress", () => runGatScript(sector));

    // ── Step 2: Grok editorial analysis ─────────────────────────────────────
    // If a topic is provided, Grok uses the GAT graph as research backing for
    // that specific angle. If not, Grok finds the most original story itself.
    const topicDirective = topic
      ? `\n\nEDITORIAL BRIEF FROM EDITOR: "${topic}"\n\nUse the signal map above as your research. Find what the graph actually says about this topic — which nodes support it, which tensions make it interesting, what angle nobody else is writing. If the data doesn't support the brief, say so and write the closest honest version of it that the graph does support.`
      : `\n\nNo editorial brief — find the most original, specific story the graph is pointing at that other publications aren't covering. The circuit feed already has the obvious takes. Find the gap.`;

    const analysis = await step.run("grok-analysis", () =>
      callGrok(
        `Sector: ${sector.toUpperCase()}\n\n${gat.map}${topicDirective}\n\n**ARTICLE LEAD:** Write the title and one-sentence hook for the article SARN should publish. Make it specific to what this signal map actually shows.\n\n**SIGNAL BREAKDOWN:**\n- What's the strongest story in this data? (name it, cite the nodes)\n- What's the dark horse signal — strong graph weight but not obvious?\n- What does this community actually care about right now that isn't the obvious answer?\n\n**EDITORIAL CALL:** One paragraph. What's the cultural moment here? What would a sharp editor see in this data that a casual reader would miss?\n\nBe specific. Cite actual nodes and scores. No boilerplate. This is for a publication, not a report.`,
        "You are SARN's signal editor. You read compressed signal maps and produce sharp, specific editorial intelligence for a speed culture publication. Every analysis should feel like a different story because the data IS different every time. Cite specific nodes. Name specific tensions. Be a journalist, not a summariser."
      )
    );

    // ── Step 2b: Grok scene params — translate signal energy into a race scene ─
    const sceneParams = await step.run("grok-scene-params", async () => {
      const raw = await callGrok(
        `Based on this editorial analysis of the ${sector} signal map:\n\n${analysis}\n\nTranslate the energy, tension, and dominant narrative into a race scene for TORCS + UE5 to render. Respond with ONLY valid JSON — no markdown, no explanation:\n\n{\n  "track": "short evocative track description (e.g. Monaco night circuit, wet Spa, Monza full attack)",\n  "weather": "clear|overcast|light_rain|heavy_rain|fog",\n  "timeOfDay": "dawn|morning|midday|dusk|night",\n  "intensity": "tactical|aggressive|chaotic|climactic",\n  "camera": "cockpit|chase|aerial|tv_broadcast|cinematic_orbit",\n  "mood": "one phrase for UE5 post-processing tone (e.g. cold blue underdog, golden hour dominance, neon wet desperation)",\n  "dominantSignal": "the single GAT node that most drove this scene choice",\n  "racerCount": <integer 2-20>\n}`,
        "You are SARN's visual director. You translate signal intelligence into race scene parameters for a real-time UE5 render. The scene must feel like a direct visual expression of the day's dominant story. Output only valid JSON."
      );
      try {
        return JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
      } catch {
        // If Grok wraps it — best-effort extraction
        const match = raw.match(/\{[\s\S]+\}/);
        return match ? JSON.parse(match[0]) : null;
      }
    });

    // ── Step 2c: Grok Imagine — generate scene starter image ─────────────────
    const sceneImage = await step.run("grok-imagine-scene", async () => {
      if (!sceneParams) return { skipped: true, url: null, localPath: null };

      const sp = sceneParams as any;
      const cameraDirective: Record<string, string> = {
        cockpit:         "first-person driver POV from INSIDE the cockpit looking FORWARD — the halo safety structure frames the top of the view, the steering wheel fills the lower foreground, the car's nose cone extends forward below the halo, the track and other cars stretch away INTO the distance ahead. Wing mirrors visible on far left and far right periphery only. Camera is BEHIND the steering wheel looking toward the front of the car. No rear bodywork visible. No driver helmet or face visible.",
        chase:           "external chase camera directly behind the lead car at track level, car filling 40% of frame, track ahead, no driver face visible",
        aerial:          "dramatic high aerial shot looking down at the cars through a corner, track markings visible",
        tv_broadcast:    "classic F1 TV broadcast angle, side-on at track level as cars blast past, motion blur on wheels",
        cinematic_orbit: "cinematic orbit shot alongside the car, low angle, track in background, car sharp foreground",
      };

      const camera = cameraDirective[sp.camera] ?? cameraDirective.chase;

      const prompt = [
        `Cinematic ${sp.timeOfDay} Formula 1 race scene: ${sp.track}.`,
        `The lead car carries the SARN+ master livery — electric cyan (#00e5ff) primary body panels, deep copper (#b86c2a) geometric fade on rear bodywork and sidepods, copper wheel rims, SARN+ S-shield logo on the nose cone, SARN+ wordmark in copper on the sidepod.`,
        `Weather: ${sp.weather}. Atmosphere: ${sp.mood}.`,
        `${sp.racerCount} cars on track. ${camera}.`,
        `Photorealistic, Unreal Engine 5 render quality, Lumen global illumination, speed culture aesthetic. ${sp.intensity} racing intensity.`,
        `No text overlays, no UI, no watermarks beyond the SARN+ livery on the car itself.`,
      ].join(" ");

      // Call xAI Aurora image generation — uses image-specific key if set
      const imageKey = process.env.XAI_IMAGE_API_KEY ?? process.env.XAI_API_KEY;
      const res = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${imageKey}`,
        },
        body: JSON.stringify({
          model: "grok-imagine-image",
          prompt,
          n: 1,
          response_format: "b64_json",
          aspect_ratio: "16:9",
          resolution: "2k",
        }),
      });

      if (!res.ok) {
        console.error(`Grok Imagine error ${res.status}: ${await res.text()}`);
        return { skipped: true, url: null, localPath: null };
      }

      const data = await res.json() as any;
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) return { skipped: true, url: null, localPath: null };

      const imageBuffer = Buffer.from(b64, "base64");
      const filename = `scene_${sector}_${Date.now()}.png`;

      // Save locally for UE5
      const localPath = `/Users/joewales/NODE_OUT_Master/torcs-mcp/scene_image.png`;
      await writeFile(localPath, imageBuffer);

      // Upload to Vercel Blob for sarn-official / TMA / Telegram
      const blob = await put(`sarn/scenes/${filename}`, imageBuffer, {
        access: "public",
        contentType: "image/png",
      });

      return { url: blob.url, localPath };
    });

    // ── Step 3: Persist ──────────────────────────────────────────────────────
    const record = await step.run("store-result", () =>
      prisma.signalRun.create({
        data: {
          sector,
          signalMap: gat.map,
          analysis,
          sceneParams,
          sceneImageUrl:  (sceneImage as any).url ?? null,
          sceneImagePath: (sceneImage as any).localPath ?? null,
          itemCount: gat.itemCount,
          nodeCount: gat.nodeCount,
        },
      })
    );

    // ── Step 4: Ingest top articles into CircuitArticle ──────────────────────
    // Extracts the top-scored articles from the TrendRadar SQLite for the day
    // and upserts them into Postgres so the /circuit page can serve them.
    await step.run("ingest-circuit-articles", async () => {
      const { execSync } = await import("child_process");
      const { join } = await import("path");
      const RSS_DIR = "/Users/joewales/NODE_OUT_Master/TrendRadar/output/rss";
      const today = new Date().toISOString().slice(0, 10);
      const dbPath = join(RSS_DIR, `${today}.db`);

      // Extract top articles via sqlite3 — join items with feed names, limit 60
      let rows: any[] = [];
      try {
        const raw = execSync(
          `sqlite3 -json "${dbPath}" "SELECT ri.title, ri.url, rf.name AS source, ri.published_at, ri.summary, ri.author FROM rss_items ri JOIN rss_feeds rf ON ri.feed_id = rf.id ORDER BY ri.crawl_count DESC, ri.published_at DESC LIMIT 60;"`,
          { encoding: "utf8", timeout: 15000 }
        );
        rows = JSON.parse(raw || "[]");
      } catch { return { skipped: true, reason: "sqlite unavailable" }; }

      if (!rows.length) return { skipped: true, reason: "no articles" };

      // Upsert — skip duplicates by URL
      let saved = 0;
      for (const row of rows) {
        try {
          await (prisma as any).circuitArticle.upsert({
            where: { url: row.url },
            update: { signalScore: 1.0 },
            create: {
              title:       row.title,
              url:         row.url,
              source:      row.source,
              sector,
              summary:     row.summary ?? null,
              author:      row.author ?? null,
              publishedAt: row.published_at ? new Date(row.published_at) : null,
              signalScore: 1.0,
            },
          });
          saved++;
        } catch { /* skip individual failures */ }
      }
      return { saved, total: rows.length };
    });

    // ── Step 5: Push scene config to TORCS ──────────────────────────────────
    await step.run("push-scene-to-torcs", async () => {
      if (!sceneParams) return { skipped: true };
      const scenePath = "/Users/joewales/NODE_OUT_Master/torcs-mcp/scene_config.json";
      await writeFile(
        scenePath,
        JSON.stringify({
          ...sceneParams,
          signalRunId:    record.id,
          sceneImagePath: (sceneImage as any).localPath ?? null,
          sceneImageUrl:  (sceneImage as any).url ?? null,
          updatedAt:      new Date().toISOString(),
        }, null, 2)
      );
      return { pushed: true, track: (sceneParams as any).track };
    });

    return {
      id:             record.id,
      sector,
      itemCount:      gat.itemCount,
      nodeCount:      gat.nodeCount,
      preview:        analysis.slice(0, 280),
      sceneParams,
      sceneImageUrl:  (sceneImage as any).url ?? null,
      sceneImagePath: (sceneImage as any).localPath ?? null,
    };
  }
);

// ── Gap 3: Circadian Pruning Loop ────────────────────────────────────────────
// Runs at midnight daily. Reads approved/rejected signal_runs from the past
// 14 days, extracts which GAT nodes appeared in each, and updates
// gat_node_weights.json with EMA-style amplification/suppression.
// gat_example.py reads this file before scoring — the graph self-improves.
const WEIGHTS_PATH = "/Users/joewales/NODE_OUT_Master/torcs-mcp/gat_node_weights.json";

export const sarnCircadianPrune = inngest.createFunction(
  {
    id: "sarn-circadian-prune",
    name: "SARN — Circadian Prune",
    retries: 1,
  },
  [
    { event: "sarn/circadian.prune" },
    { cron: "0 0 * * *" }, // midnight daily
  ],
  async ({ event, step }) => {
    if (process.env.VERCEL) {
      return { skipped: true, reason: "local-only — run via Inngest dev server" };
    }

    const sector = (event as any).data?.sector ?? "racing";

    // ── Step 1: Load reviewed signal runs (last 14 days) ────────────────────
    const reviewed = await step.run("load-reviewed-runs", () =>
      prisma.signalRun.findMany({
        where: {
          sector,
          status: { in: ["approved", "rejected"] },
          runAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
        select: { id: true, status: true, signalMap: true, runAt: true },
        orderBy: { runAt: "desc" },
        take: 50,
      })
    );

    // Minimum signal threshold — don't touch weights on noise.
    // Need at least 5 reviewed runs before EMA has any basis to move weights.
    // Below this: no updates, no decay, nothing written. Weights stay frozen.
    const MIN_REVIEWS = 5;
    if (reviewed.length < MIN_REVIEWS) {
      return {
        sector,
        reviewedRuns: reviewed.length,
        message: `Insufficient signal (${reviewed.length}/${MIN_REVIEWS} reviewed runs) — weights unchanged.`,
      };
    }

    // ── Step 2: Compute updated weights ─────────────────────────────────────
    const weights = await step.run("compute-weights", async () => {
      // Load existing weights (preserve other sectors)
      let existing: Record<string, number> = {};
      try {
        const raw = await readFile(WEIGHTS_PATH, "utf8");
        existing = JSON.parse(raw).weights?.[sector] ?? {};
      } catch { /* first run — start fresh */ }

      // Extract node names from each run's signalMap and accumulate deltas
      // Format: "  {n}. {node}              freq={f}  score={s}  → ..."
      const nodeDeltas: Record<string, number[]> = {};
      for (const run of reviewed) {
        const delta = run.status === "approved" ? 1.5 : 0.5;
        for (const m of run.signalMap.matchAll(/^\s+\d+\.\s+(\S+)\s+freq=/gm)) {
          const node = m[1];
          if (!nodeDeltas[node]) nodeDeltas[node] = [];
          nodeDeltas[node].push(delta);
        }
      }

      // EMA: new = old * 0.7 + avg_delta * 0.3, clamped [0.3, 2.5]
      const updated: Record<string, number> = { ...existing };
      for (const [node, deltas] of Object.entries(nodeDeltas)) {
        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const prev = existing[node] ?? 1.0;
        updated[node] = Math.round(
          Math.min(2.5, Math.max(0.3, prev * 0.7 + avgDelta * 0.3)) * 1000
        ) / 1000;
      }

      // Decay nodes not seen in recent runs back toward neutral (1.0)
      for (const node of Object.keys(existing)) {
        if (!(node in nodeDeltas)) {
          updated[node] = Math.round(
            (existing[node] * 0.97 + 1.0 * 0.03) * 1000
          ) / 1000;
        }
      }

      return updated;
    });

    // ── Step 3: Write weights file ───────────────────────────────────────────
    await step.run("write-weights", async () => {
      let full: any = { version: 1, weights: {} };
      try {
        const raw = await readFile(WEIGHTS_PATH, "utf8");
        full = JSON.parse(raw);
      } catch { /* first write */ }

      full.weights[sector] = weights;
      full.updatedAt = new Date().toISOString();
      full.reviewedRuns = reviewed.length;

      await writeFile(WEIGHTS_PATH, JSON.stringify(full, null, 2));
    });

    const w = weights as Record<string, number>;
    const amplified = Object.entries(w).filter(([, v]) => v > 1.1).map(([n]) => n).sort();
    const suppressed = Object.entries(w).filter(([, v]) => v < 0.9).map(([n]) => n).sort();

    return {
      sector,
      reviewedRuns: reviewed.length,
      weightedNodes: Object.keys(w).length,
      amplified: amplified.slice(0, 15),
      suppressed: suppressed.slice(0, 15),
    };
  }
);
