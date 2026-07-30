// PROTOTYPE ONLY — blind byte recorder for Issue #69 transport audits.
import { createWriteStream, mkdirSync } from "node:fs";
import net from "node:net";
import process from "node:process";

const outputDirectory = process.env.ISSUE69_CAPTURE_DIRECTORY;
if (!outputDirectory) {
  process.stderr.write("Set ISSUE69_CAPTURE_DIRECTORY to an isolated temporary directory.\n");
  process.exit(2);
}

const listenHost = process.env.ISSUE69_CAPTURE_LISTEN_HOST ?? "127.0.0.1";
const listenPort = Number(process.env.ISSUE69_CAPTURE_LISTEN_PORT ?? "7891");
const upstreamHost = process.env.ISSUE69_CAPTURE_UPSTREAM_HOST ?? "127.0.0.1";
const upstreamPort = Number(process.env.ISSUE69_CAPTURE_UPSTREAM_PORT ?? "7890");
const captureLimit = Number(process.env.ISSUE69_CAPTURE_LIMIT_BYTES ?? `${8 * 1024 * 1024}`);

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

let nextConnectionId = 1;
const activeSockets = new Set();
const metrics = new Map();

function captureStream(connectionId, direction) {
  const output = createWriteStream(
    `${outputDirectory}/${String(connectionId).padStart(4, "0")}-${direction}.bin`,
    { mode: 0o600 },
  );
  let capturedBytes = 0;
  let observedBytes = 0;

  return {
    observe(chunk) {
      observedBytes += chunk.length;
      if (capturedBytes < captureLimit) {
        const remaining = captureLimit - capturedBytes;
        const captured = chunk.subarray(0, remaining);
        output.write(captured);
        capturedBytes += captured.length;
      }
    },
    close() {
      output.end();
      return { observedBytes, capturedBytes, truncated: observedBytes > capturedBytes };
    },
  };
}

const server = net.createServer((client) => {
  const connectionId = nextConnectionId;
  nextConnectionId += 1;
  const upstream = net.createConnection({ host: upstreamHost, port: upstreamPort });
  const clientToUpstream = captureStream(connectionId, "client-to-upstream");
  const upstreamToClient = captureStream(connectionId, "upstream-to-client");
  let closed = false;

  activeSockets.add(client);
  activeSockets.add(upstream);

  const finish = () => {
    if (closed) return;
    closed = true;
    metrics.set(connectionId, {
      connectionId,
      clientToUpstream: clientToUpstream.close(),
      upstreamToClient: upstreamToClient.close(),
    });
    activeSockets.delete(client);
    activeSockets.delete(upstream);
  };

  client.on("data", (chunk) => clientToUpstream.observe(chunk));
  upstream.on("data", (chunk) => upstreamToClient.observe(chunk));
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", finish);
  upstream.on("close", finish);
  client.pipe(upstream);
  upstream.pipe(client);
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(JSON.stringify({
    event: "listening",
    listen: `${listenHost}:${listenPort}`,
    upstream: `${upstreamHost}:${upstreamPort}`,
    captureLimit,
  }) + "\n");
});

function stop() {
  server.close(() => {
    process.stdout.write(JSON.stringify({
      event: "stopped",
      connections: [...metrics.values()],
    }) + "\n");
    process.exit(0);
  });
  for (const socket of activeSockets) socket.destroy();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
