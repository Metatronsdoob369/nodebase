import { spawn } from "child_process";
import { readFile } from "fs/promises";
import path from "path";

// Bridge 2: Expose EVE v1 GSI Score to OMC Bridge (port 8080)
// Hooks eve_v1.py output (GSI > 0.95) to governance validation.
// Integrates with MCP config for spectral truth checks pre-physics.

export class EveGsiIntegrator {
  private eveScriptPath = "/Users/joewales/NODE_OUT_Master/domicile_live/Skills/HK_101/eve_v1.py";
  private bridgeUrl = "http://localhost:8080/v1/contract/gsi-expose";

  // Run EVE v1 and extract GSI score from stdout (parse diagnostics)
  async computeGsi(landmarksInput: any): Promise<{ gsiScore: number; diagnostics: any }> {
    return new Promise((resolve, reject) => {
      const proc = spawn("conda", ["run", "-n", "agents", "python", this.eveScriptPath, "--demo"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`EVE v1 failed: ${stderr}`));
          return;
        }

        // Parse GSI from stdout (e.g., "GSI alignment score: 0.XXXX")
        const gsiMatch = stdout.match(/GSI alignment score: ([\d.]+)/);
        const score = gsiMatch ? parseFloat(gsiMatch[1]) : 0.0;

        // Parse full diagnostics (JSON-like block)
        const diagMatch = stdout.match(/Triad Diagnostics:\s*({[\s\S]+?})/);
        const diagnostics = diagMatch ? JSON.parse(diagMatch[1]) : {};

        resolve({ gsiScore: score, diagnostics });
      });

      proc.on("error", reject);

      // Input landmarks if provided (stdin pipe)
      if (landmarksInput) {
        proc.stdin.write(JSON.stringify(landmarksInput));
        proc.stdin.end();
      }
    });
  }

  // Expose GSI to OMC Bridge: POST score + diagnostics for validation hook
  async exposeToBridge(gsiData: { gsiScore: number; diagnostics: any }): Promise<{ success: boolean; auditId: string }> {
    const res = await fetch(this.bridgeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.CONTRACT_BRIDGE_KEY || "development-only-key",
        "X-Domain": "racing",
      },
      body: JSON.stringify({
        gsiScore: gsiData.gsiScore,
        diagnostics: gsiData.diagnostics,
        threshold: 0.95, // Enforce >0.95 for ARMED
        timestamp: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      throw new Error(`Bridge expose failed: ${res.status}`);
    }

    const response = await res.json() as { success: boolean; auditId: string; message?: string };
    if (!response.success && response.message?.includes('GSI < 0.95')) {
      throw new Error('Spectral truth violation: GSI below threshold');
    }

    return response;
  }

  // Full integration: Compute + Expose (call from sarn-signal.ts Step 4.5)
  async validateWithGsi(landmarksInput: any): Promise<{ success: boolean; auditId: string; gsiScore: number }> {
    const gsiData = await this.computeGsi(landmarksInput);
    const bridgeResponse = await this.exposeToBridge(gsiData);
    return { success: bridgeResponse.success, auditId: bridgeResponse.auditId, gsiScore: gsiData.gsiScore };
  }
}

// Export for use in workflow-validator.ts or sarn-signal.ts
// Usage: const integrator = new EveGsiIntegrator(); await integrator.validateWithGsi(landmarks);
