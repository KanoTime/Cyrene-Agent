import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { createScenario } from "./scenario.mjs";
import { runTui } from "./tui.mjs";

const origin = "http://127.0.0.1:8799";
const runToken = `p69_run_${randomBytes(24).toString("base64url")}`;
const wrangler = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--local",
    "--port",
    "8799",
    "--config",
    "prototype/issue69-relay/wrangler.jsonc",
    "--var",
    `ISSUE69_PROTOTYPE_RUN_TOKEN:${runToken}`,
    "--show-interactive-dev-session=false",
  ],
  {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  },
);

let output = "";
wrangler.stdout.on("data", (chunk) => { output += chunk.toString(); });
wrangler.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitForHealth(origin, wrangler);
  if (process.argv.includes("--scenario")) {
    const events = [];
    const scenario = await createScenario({
      origin,
      runToken,
      onState: (event, state) => {
        events.push({ event, state });
        process.stdout.write(`${event}: ${JSON.stringify(state)}\n`);
      },
    });
    await scenario.runAll();
    process.stdout.write(`PASS: ${events.length} observable prototype states\n`);
  } else {
    await runTui({ origin, runToken });
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.stderr.write(output.slice(-4_000));
  process.exitCode = 1;
} finally {
  wrangler.kill("SIGTERM");
  await Promise.race([once(wrangler, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
}

async function waitForHealth(target, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`WRANGLER_EXITED_${child.exitCode}`);
    try {
      const response = await fetch(`${target}/healthz`);
      if (response.ok) return;
    } catch {
      // Keep polling until Wrangler is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("WRANGLER_START_TIMEOUT");
}
