import Native from "../NativeDesktopApp";
import { onDesktopEvent, type DesktopEvent } from "../events";
import type { Subscription } from "../contracts";
import type { NetworkRecorder } from "./recorder";

// Development bundles only, the shared runtime. HTTP requests that Spark's native modules make themselves
// (macos/SparkNetworkRequests.h). Native reports them, as `nativeNetwork` desktop events, only while the recorder is
// active: reportNativeNetwork turns that on with the body cap, and off.

type Body = { base64: string; size: number };
type NativeRequest = { phase: "request"; id: string; module: string; method: string; url: string; headers: Record<string, string>; body?: Body };
type NativeEnd = { phase: "end"; id: string; status?: number; headers?: Record<string, string>; url?: string; body?: Body; error?: string; canceled?: boolean };

export function nativeRequests(recorder: NetworkRecorder) {
  /** Native request id → entry id. */
  const requests = new Map<string, string>();
  let subscription: Subscription | undefined;
  /** The body cap native reports with, or null while it does not report. */
  let reported: number | null = null;

  const event = (raw: DesktopEvent) => {
    const value = raw as unknown as NativeRequest | NativeEnd;
    if (value.phase === "request") {
      const id = recorder.request({ source: "native", module: value.module, method: value.method, url: value.url, headers: value.headers, body: value.body });
      if (id !== undefined) requests.set(value.id, id);
      return;
    }
    const id = requests.get(value.id);
    if (id === undefined) return;
    requests.delete(value.id);
    if (value.error !== undefined) { recorder.fail(id, value.error, value.canceled === true); return; }
    if (value.status !== undefined) recorder.response(id, { status: value.status, headers: value.headers, url: value.url });
    if (value.body) recorder.data(id, value.body);
    recorder.finish(id);
  };

  const report = (maxBodySize: number | null) => {
    reported = maxBodySize;
    Native!.call("reportNativeNetwork", JSON.stringify({ maxBodySize })).catch(console.error);
  };
  // A reloaded runtime starts with native still reporting for the one before it.
  if (Native) report(null);

  return {
    /** Native reports while the recorder is active, keeping the recorder's maxBodySize of each body. */
    observe(active: boolean) {
      // Without Spark's app module there are no Spark native modules, so no native requests.
      if (!Native) return;
      const maxBodySize = active ? recorder.options.maxBodySize : null;
      if (maxBodySize === reported) return;
      if (active && !subscription) subscription = onDesktopEvent(event, { types: ["nativeNetwork"] });
      if (!active) { subscription?.remove(); subscription = undefined; requests.clear(); }
      report(maxBodySize);
    },
  };
}
