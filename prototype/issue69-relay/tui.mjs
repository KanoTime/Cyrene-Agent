import readline from "node:readline";
import { createScenario } from "./scenario.mjs";
import { initialPrototypeState, reducePrototypeState } from "./relay-model.mjs";

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

export async function runTui({ origin, runToken }) {
  let state = reducePrototypeState(initialPrototypeState(), {
    type: "WORKER_READY",
    result: origin,
  });
  const scenario = await createScenario({
    origin,
    runToken,
    onState: (event, result) => {
      if (event === "rfcVector") {
        state = reducePrototypeState(state, {
          type: "RFC_VECTOR",
          passed: result.passed,
          result: JSON.stringify(result),
        });
      } else if (event === "connected") {
        state = reducePrototypeState(state, {
          type: "CONNECTED",
          result: JSON.stringify(result),
        });
      } else if (event === "offline") {
        state = reducePrototypeState(state, {
          type: "MESSAGE",
          gate: "offline recovery",
          result: JSON.stringify(result),
        });
      } else if (event === "revoked") {
        state = reducePrototypeState(state, {
          type: "REVOKED",
          result: JSON.stringify(result),
        });
      } else if (event === "audit") {
        state = reducePrototypeState(state, {
          type: "AUDIT",
          audit: result,
          result: "sentinel absent from relay storage audit",
        });
      } else {
        state = reducePrototypeState(state, {
          type: "MESSAGE",
          gate: event,
          result: JSON.stringify(result),
        });
      }
      render(state);
    },
  });

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  render(state);
  await new Promise((resolve) => {
    process.stdin.on("keypress", async (_chunk, key) => {
      try {
        if (key.name === "q" || (key.ctrl && key.name === "c")) {
          scenario.desktop.close();
          scenario.mobile.close();
          resolve();
          return;
        }
        if (key.name === "k") await scenario.rfcVector();
        if (key.name === "c") await scenario.connect();
        if (key.name === "s") await scenario.roundTrip();
        if (key.name === "i") await scenario.identityAndTamper();
        if (key.name === "r") await scenario.replayAndIdempotency();
        if (key.name === "o") await scenario.offlineRecovery();
        if (key.name === "b") await scenario.backpressure();
        if (key.name === "v") await scenario.revoke();
        if (key.name === "u") await scenario.audit();
        if (key.name === "a") await scenario.runAll();
      } catch (error) {
        state = reducePrototypeState(state, {
          type: "ERROR",
          gate: key.name,
          error: error instanceof Error ? error.message : String(error),
        });
        render(state);
      }
    });
  });
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}

function render(state) {
  console.clear();
  process.stdout.write(`${BOLD}Cyrene #69 Relay Prototype${RESET}\n`);
  process.stdout.write(`${DIM}Throwaway fake data only — no production credentials${RESET}\n\n`);
  for (const [key, value] of Object.entries(state)) {
    process.stdout.write(`${BOLD}${key.padEnd(22)}${RESET} ${format(value)}\n`);
  }
  process.stdout.write(`\n${BOLD}[k]${RESET} RFC vector  ${BOLD}[c]${RESET} connect  ${BOLD}[s]${RESET} sentinel\n`);
  process.stdout.write(`${BOLD}[i]${RESET} identity/tamper  ${BOLD}[r]${RESET} replay  ${BOLD}[o]${RESET} offline/reconnect\n`);
  process.stdout.write(`${BOLD}[b]${RESET} backpressure  ${BOLD}[v]${RESET} revoke  ${BOLD}[u]${RESET} audit\n`);
  process.stdout.write(`${BOLD}[a]${RESET} run all  ${BOLD}[q]${RESET} quit\n`);
}

function format(value) {
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
