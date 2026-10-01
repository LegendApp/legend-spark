import { spawnProcess } from "../packages/cli/src/process.ts";
// Standalone native protocol checks; does not start a browser or React Native.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
if (process.platform !== "darwin") throw new Error("Compile tests/auth-loopback.integration.cpp with the platform C++20 toolchain on Windows.");
const directory = mkdtempSync(path.join(tmpdir(), "spark-auth-loopback-"));
let child: ReturnType<typeof spawnProcess> | undefined;
try {
  const binary = path.join(directory, "receiver");
  const compile = spawnProcess(["clang++", "-std=c++20", "-pthread", "tests/auth-loopback.integration.cpp", "-o", binary], { stdout: "inherit", stderr: "inherit" });
  if (await compile.exited) throw new Error("Native loopback fixture failed to compile");
  child = spawnProcess([binary], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader(); let buffered = "";
  async function line(): Promise<string> {
    while (!buffered.includes("\n")) { const result = await reader.read(); if (result.done) throw new Error("Receiver exited early"); buffered += new TextDecoder().decode(result.value); }
    const end = buffered.indexOf("\n"), value = buffered.slice(0, end); buffered = buffered.slice(end + 1); return value;
  }
  const uri = await line(), url = new URL(uri);
  async function request(raw: string) { return new Promise<string>((resolve, reject) => {
    const socket = net.connect(Number(url.port), "127.0.0.1", () => socket.write(raw));
    let response = ""; socket.on("data", data => response += data); socket.on("end", () => resolve(response));
    socket.on("error", error => {
      // Rejecting an oversized request can reset a socket with unread input.
      // Accept that close only after receiving the complete HTTP response.
      const end = response.indexOf("\r\n\r\n");
      const length = /Content-Length: (\d+)/i.exec(response.slice(0, end));
      if ((error as NodeJS.ErrnoException).code === "ECONNRESET" && end >= 0 && length && Buffer.byteLength(response.slice(end + 4)) === Number(length[1])) resolve(response);
      else reject(error);
    });
    socket.setTimeout(3000, () => socket.destroy(new Error("Socket timed out")));
  }); }
  for (const raw of [
    `POST /auth/callback HTTP/1.1\r\nHost: ${url.host}\r\n\r\n`,
    `GET /wrong HTTP/1.1\r\nHost: ${url.host}\r\n\r\n`,
    "GET /auth/callback HTTP/1.1\r\nHost: evil.example\r\n\r\n",
    `GET /auth/callback HTTP/1.1\r\nHost: ${url.host}\r\nX-Large: ${"x".repeat(9000)}\r\n\r\n`,
  ]) if (!(await request(raw)).startsWith("HTTP/1.1 400")) throw new Error("Malformed callback accepted");
  const accepted = `${uri}?state=valid&code=example`;
  if (!(await request(`GET /auth/callback?state=valid&code=example HTTP/1.1\r\nHost: ${url.host}\r\n\r\n`)).startsWith("HTTP/1.1 200")) throw new Error("Valid callback rejected");
  if (await line() !== accepted) throw new Error("Callback event mismatch");
  (child.stdin as any).write("quit\n");
  if (await child.exited) throw new Error("Native receiver failed");
  let reachable = false; try { await fetch(uri); reachable = true; } catch {} if (reachable) throw new Error("Disposed callback listener survived");
  console.log("PASS native loopback rejects malformed requests, delivers callback and closes its socket");
} finally { child?.kill(); rmSync(directory, { recursive: true, force: true }); }
