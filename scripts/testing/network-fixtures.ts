// Loopback HTTP and WebSocket endpoints for the network inspector (docs/devtools.md#network-inspector): what the
// Kitchen Sink's DevTools › Network screen requests. Listens on 127.0.0.1 only. scripts/test-network-inspector.ts
// starts it; for a person, `bun scripts/testing/network-fixtures.ts` prints its URL to paste into the screen.
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { WebSocketServer } from "ws";

export const TEXT = "Kitchen Sink network inspector ✓";
export const BINARY = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
export const LARGE = "0123456789abcdef".repeat(200 * 1024 / 16);
// A 1×1 PNG: the Now Playing artwork Spark's audio module loads natively.
export const ARTWORK = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
// 1 KB parts: URLSession holds back a response's first 512 bytes (content sniffing), so smaller parts arrive as one.
export const STREAM = Array.from({ length: 5 }, (_, i) => `chunk-${i + 1} ${".".repeat(1013)}\n`);

export type FixtureRequest = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer };

export async function serveNetworkFixtures() {
  const requests: FixtureRequest[] = [];
  const sockets = new Set<Socket>();
  let aborted = 0;
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({ method: request.method ?? "GET", url: url.pathname, headers: request.headers, body: Buffer.concat(chunks) });
    switch (url.pathname) {
      case "/text": response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "set-cookie": "ks-session=fixture-secret; HttpOnly" }).end(TEXT); return;
      case "/artwork.png": response.writeHead(200, { "content-type": "image/png", "set-cookie": "ks-session=fixture-secret; HttpOnly" }).end(ARTWORK); return;
      case "/binary": response.writeHead(200, { "content-type": "application/octet-stream" }).end(BINARY); return;
      case "/echo": response.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.concat(chunks)); return;
      case "/redirect": response.writeHead(302, { location: "/text" }).end(); return;
      case "/large": response.writeHead(200, { "content-type": "text/plain" }).end(LARGE); return;
      case "/stream": {
        response.writeHead(200, { "content-type": "text/plain" });
        for (const part of STREAM) { response.write(part); await new Promise(resolve => setTimeout(resolve, 150)); }
        response.end();
        return;
      }
      case "/hang":
        response.writeHead(200, { "content-type": "text/plain" });
        response.write("started\n");
        response.on("close", () => { if (!response.writableFinished) aborted++; });
        return;
      default: response.writeHead(404).end();
    }
  });
  const echo = new WebSocketServer({ server, path: "/ws" });
  echo.on("connection", socket => socket.on("message", (data, binary) => socket.send(data, { binary })));
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return {
    url, requests,
    /** Requests to /hang whose connection the client closed before the response ended. */
    aborted: () => aborted,
    async stop() {
      for (const client of echo.clients) client.terminate();
      echo.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

if (import.meta.main) {
  const fixtures = await serveNetworkFixtures();
  console.log(`Network inspector fixtures at ${fixtures.url} (127.0.0.1 only). Paste it into DevTools › Network. Ctrl+C stops.`);
  process.once("SIGINT", () => void fixtures.stop().then(() => process.exit(0)));
}
