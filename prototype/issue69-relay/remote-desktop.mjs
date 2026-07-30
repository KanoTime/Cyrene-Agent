import process from "node:process";
import { PrototypeEndpoint } from "./endpoint.mjs";

const origin = process.env.ISSUE69_ORIGIN?.replace(/\/$/u, "");
const runToken = process.env.ISSUE69_RUN_TOKEN;
if (!origin || !runToken) {
  process.stderr.write(
    "Set ISSUE69_ORIGIN and ISSUE69_RUN_TOKEN for the isolated prototype Worker.\n",
  );
  process.exit(2);
}

const desktop = new PrototypeEndpoint({
  role: "desktop",
  origin,
  runToken,
  sentinel: "desktop-does-not-know-mobile-sentinel-before-decryption",
});
await desktop.connect();
process.stdout.write(`desktop connected: ${desktop.key.fingerprint}\n`);

let handled = 0;
let activePeerEpoch = "";
const poll = setInterval(async () => {
  while (handled < desktop.received.length) {
    const received = desktop.received[handled];
    handled += 1;
    if (received.error) {
      process.stdout.write(
        `rejected ciphertext ${received.envelope?.operationId ?? "unknown"}: ${received.error}\n`,
      );
      continue;
    }
    if (activePeerEpoch && activePeerEpoch !== received.envelope.channelEpoch) {
      desktop.retirePeerEpoch(activePeerEpoch);
      process.stdout.write(`retired peer epoch: ${activePeerEpoch}\n`);
    }
    activePeerEpoch = received.envelope.channelEpoch;
    const { operationId, kind, payload } = received.inner;
    process.stdout.write(`decrypted ${kind} ${operationId}: ${JSON.stringify(payload)}\n`);
    await desktop.send({
      operationId: `ack-${operationId}`,
      kind: "desktop_ack",
      payload: { receivedOperationId: operationId, status: "persisted-on-fake-desktop" },
    });
  }
}, 100);

process.on("SIGINT", () => {
  clearInterval(poll);
  desktop.close();
  process.exit(0);
});
