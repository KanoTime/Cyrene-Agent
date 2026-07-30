import process from "node:process";
import { createScenario } from "./scenario.mjs";

const origin = process.env.ISSUE69_ORIGIN?.replace(/\/$/u, "");
const runToken = process.env.ISSUE69_RUN_TOKEN;

if (!origin || !runToken) {
  throw new Error("ISSUE69_ORIGIN_AND_ISSUE69_RUN_TOKEN_REQUIRED");
}

const events = [];
const scenario = await createScenario({
  origin,
  runToken,
  offlineDurations: process.env.ISSUE69_LONG_GATE === "1"
    ? [30_000, 300_000]
    : [100],
  onState: (event, state) => {
    events.push({ event, state });
    process.stdout.write(`${event}: ${JSON.stringify(state)}\n`);
  },
});

try {
  await scenario.runAll();
  process.stdout.write(`PASS: ${events.length} observable remote prototype states\n`);
} finally {
  scenario.desktop.close();
  scenario.mobile.close();
}
