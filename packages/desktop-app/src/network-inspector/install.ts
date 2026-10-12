// Development bundles on macOS only: @legendapp/spark/runtime-entry requires this inside `if (__DEV__)`, on macOS, in
// every JavaScript runtime, so release bundles contain none of the inspector (tests/developer-menu-release.test.ts; the release-safety
// probe's DEVT-REL-04 looks for NETWORK_INSPECTOR_MARKER in a release build's JavaScript).
import getDevServer from "react-native/Libraries/Core/Devtools/getDevServer";
import { registerNetworkInspector, type NetworkEntry } from "../network-inspector";
import { intercept, readBlob } from "./intercept";
import { NETWORK_INSPECTOR_MARKER } from "./marker";
import { NetworkRecorder } from "./recorder";

/** React Native's debugger session observer (jsinspector-modern): a session is active while DevTools is attached. */
type SessionObserver = { hasActiveSession: boolean; subscribers: Set<(active: boolean) => void> };
const MAX_QUEUED = 1000;

/**
 * The development server's Network channel. Expo CLI (spark dev) serves `/inspector/network` and passes every
 * `Network.*` message to the attached DevTools, and keeps `Expo(Network.receivedResponseBody)` bodies for
 * `Network.getResponseBody`. Messages wait (at most MAX_QUEUED) while the socket connects.
 */
function channel(url: string, open: (url: string) => WebSocket) {
  const socket = open(url);
  let queue: string[] | undefined = [], failed = false;
  socket.onopen = () => { for (const message of queue ?? []) socket.send(message); queue = undefined; };
  const fail = (why: string) => {
    if (failed) return;
    failed = true; queue = undefined;
    console.warn(`Network inspector: React Native DevTools gets no network events: ${why} (${url}). The Network panel needs Expo CLI's development server (spark dev).`);
  };
  socket.onerror = event => fail((event as { message?: string }).message ?? "the connection failed");
  socket.onclose = event => fail(`the connection closed (${event.code}${event.reason ? ` ${event.reason}` : ""})`);
  return {
    send(method: string, params: object) {
      if (failed) return;
      const message = JSON.stringify({ method, params });
      if (!queue) { socket.send(message); return; }
      queue.push(message);
      if (queue.length > MAX_QUEUED) queue.shift();
    },
    close() { failed = true; socket.onclose = null; socket.close(); },
  };
}

export function installNetworkInspector(): void {
  const runtime = (globalThis as { __THREADED_RUNTIME_ENV__?: { runtimeName?: string } }).__THREADED_RUNTIME_ENV__?.runtimeName ?? "shared";
  const recorder = new NetworkRecorder(`${NETWORK_INSPECTOR_MARKER}:${runtime}:${Date.now().toString(36)}:`, readBlob);
  const interception = intercept(recorder);
  const observer = (globalThis as { __DEBUGGER_SESSION_OBSERVER__?: SessionObserver }).__DEBUGGER_SESSION_OBSERVER__;
  const server = getDevServer();
  const listeners = new Set<(entry: NetworkEntry) => void>();
  let devtools: ReturnType<typeof channel> | undefined;

  const entry = (value: NetworkEntry) => {
    for (const listener of [...listeners]) {
      try { listener(value); } catch (error) { console.error(error); }
    }
  };
  /** Records while a listener exists or DevTools is attached to this runtime (a development server's session). */
  const update = () => {
    const attached = !!observer?.hasActiveSession && server.bundleLoadedFromServer;
    if (attached && !devtools) devtools = channel(`${server.url.replace(/^http/, "ws")}inspector/network`, url => interception.internal(() => new WebSocket(url)));
    if (!attached && devtools) { devtools.close(); devtools = undefined; }
    recorder.observe({ entry: listeners.size ? entry : undefined, devtools: devtools?.send });
    interception.observe(recorder.active);
  };
  observer?.subscribers.add(update);
  update();

  registerNetworkInspector({
    addListener(listener) {
      const registration = (value: NetworkEntry) => listener(value);
      listeners.add(registration);
      update();
      return { remove() { if (listeners.delete(registration)) update(); } };
    },
    log: () => recorder.log(),
    configure: options => recorder.configure(options),
  });
}
