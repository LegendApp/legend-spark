import { useState, useSyncExternalStore } from "react";
import { createMediaSession } from "@legendapp/spark/audio";
import { addNetworkListener, configureNetworkInspector, getNetworkInspectorAvailability, getNetworkLog, type NetworkEntry } from "@legendapp/spark/devtools";

// Requests for DevTools › Network against the loopback fixtures of scripts/testing/network-fixtures.ts (the test
// starts them; a person runs that script and pastes its URL). Each scenario returns what the app received, so a test
// can compare it with what the server sent: the inspector must not change it.
export const SCENARIOS = ["fetch", "xhr", "binary", "upload", "redirect", "stream", "abort", "large", "websocket", "artwork"] as const;
export type Scenario = (typeof SCENARIOS)[number];

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const BYTES = Uint8Array.from({ length: 256 }, (_, i) => i);

function xhr(url: string, setup: (request: XMLHttpRequest) => void = () => {}) {
  return new Promise<XMLHttpRequest>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url);
    setup(request);
    request.onload = () => resolve(request);
    request.onerror = () => reject(new Error("XMLHttpRequest failed"));
    request.send();
  });
}

function websocket(base: string) {
  return new Promise<{ text: string; bytes: string; code: number }>((resolve, reject) => {
    const socket = new WebSocket(`${base.replace(/^http/, "ws")}ws`);
    socket.binaryType = "arraybuffer";
    const received: (string | ArrayBuffer)[] = [];
    socket.onopen = () => { socket.send("hello"); socket.send(Uint8Array.of(0, 1, 2, 255)); };
    socket.onmessage = event => { received.push(event.data); if (received.length === 2) socket.close(1000, "done"); };
    socket.onerror = () => reject(new Error("WebSocket failed"));
    socket.onclose = event => resolve({ text: String(received[0]), bytes: hex(new Uint8Array(received[1] as ArrayBuffer)), code: event.code });
  });
}

/**
 * A native module's own request: Spark's audio module loads Now Playing artwork natively. Waits up to 5 s for its entry,
 * which the shared runtime records while this screen or DevTools observes, then removes the media session.
 */
async function artwork(base: string) {
  const url = `${base}artwork.png`;
  const session = await createMediaSession({ metadata: { title: "Network inspector", artworkUrl: url }, onCommand() {} });
  try {
    const ended = () => getNetworkLog().find(entry => entry.url === url && entry.state !== "pending");
    for (const deadline = Date.now() + 5000; !ended() && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 50));
    const entry = ended();
    return entry ? { source: entry.source, module: entry.module, state: entry.state, status: entry.status } : { recorded: false };
  } finally { await session.remove(); }
}

/** Runs one scenario against the fixtures at `base` (http://127.0.0.1:<port>/) and returns what the app received. */
export async function runScenario(scenario: Scenario, base: string): Promise<object> {
  switch (scenario) {
    case "fetch": {
      const response = await fetch(`${base}text`, { headers: { Authorization: "Bearer ks-secret", Cookie: "ks=cookie-secret" } });
      return { status: response.status, text: await response.text() };
    }
    case "xhr": {
      const request = await xhr(`${base}text`, request => request.setRequestHeader("Authorization", "Bearer ks-secret"));
      return { status: request.status, text: request.responseText };
    }
    case "binary": return { bytes: hex(new Uint8Array(await (await fetch(`${base}binary`)).arrayBuffer())) };
    case "upload": return { bytes: hex(new Uint8Array(await (await fetch(`${base}echo`, { method: "POST", body: BYTES })).arrayBuffer())) };
    case "redirect": {
      const response = await fetch(`${base}redirect`);
      return { status: response.status, url: response.url, text: await response.text() };
    }
    case "stream": {
      let progress = 0;
      const request = await xhr(`${base}stream`, request => { request.onprogress = () => { progress++; }; });
      return { text: request.responseText, progress };
    }
    case "abort": {
      const controller = new AbortController();
      const request = fetch(`${base}hang`, { signal: controller.signal });
      setTimeout(() => controller.abort(), 300);
      return request.then(() => ({ aborted: false }), (error: Error) => ({ aborted: true, name: error.name }));
    }
    case "large": return { length: (await (await fetch(`${base}large`)).text()).length };
    case "websocket": return websocket(base);
    case "artwork": return artwork(base);
  }
}

const subscribe = (onChange: () => void) => { const subscription = addNetworkListener(onChange); return () => subscription.remove(); };
const none: readonly NetworkEntry[] = [];
/** The network log while the screen shows it (subscribing turns recording on). */
function useNetworkLog(enabled: boolean): readonly NetworkEntry[] {
  return useSyncExternalStore(enabled ? subscribe : () => () => {}, enabled ? getNetworkLog : () => none);
}

export function useNetworkDemo() {
  const availability = getNetworkInspectorAvailability();
  const log = useNetworkLog(availability.available);
  const [server, setServer] = useState("");
  const [results, setResults] = useState<Partial<Record<Scenario, string>>>({});
  const base = /^http:\/\/127\.0\.0\.1:\d+\/$/.test(server) ? server : undefined;
  const run = (scenario: Scenario) => {
    if (!base) return;
    runScenario(scenario, base).then(value => JSON.stringify(value), (error: Error) => `${error.name}: ${error.message}`)
      .then(result => setResults(current => ({ ...current, [scenario]: result })));
  };
  return { availability, log, server, setServer, base, results, run };
}

// In the shared runtime's DevTools console, or over CDP (scripts/test-network-inspector.ts): ksNetwork.run("fetch", url).
if (__DEV__) (globalThis as { ksNetwork?: unknown }).ksNetwork = { run: runScenario, log: () => getNetworkLog(), availability: getNetworkInspectorAvailability, configure: configureNetworkInspector };
