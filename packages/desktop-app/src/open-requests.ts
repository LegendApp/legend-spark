import { Platform } from "react-native";
import { SparkError, type Subscription } from "./contracts";
import { nativePath } from "./contracts/path";
import { onDesktopEvent } from "./events";
import { callAppNative } from "./transport";
export type OpenRequest = { type: "file"; id: string; path: string } | { type: "url"; id: string; url: string };
function request(value: unknown): OpenRequest {
  if (!value || typeof value !== "object") throw new SparkError("E_INVALID_DATA", "Invalid native open request");
  const event = value as { type?: unknown; id?: unknown; url?: unknown };
  if (typeof event.id !== "string" || !event.id || typeof event.url !== "string" || !/^[a-z][a-z0-9+.-]*:/i.test(event.url) || event.url.includes("\0")) throw new SparkError("E_INVALID_DATA", "Invalid native open request");
  if (event.type === "openURL") return { type: "url", id: event.id, url: event.url };
  if (event.type === "openFile" && event.url.startsWith("file://")) {
    try { return { type: "file", id: event.id, path: nativePath(event.url, Platform.OS) }; }
    catch (cause) { throw new SparkError("E_INVALID_DATA", "Invalid file-open URL", { cause }); }
  }
  throw new SparkError("E_INVALID_DATA", "Invalid native open request type");
}
/** Each subscription replays retained launch requests, deduplicating concurrent live delivery. */
export async function subscribeToOpenRequests(listener: (event: OpenRequest) => void): Promise<Subscription> {
  if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected open-request listener");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Desktop open requests require a desktop host");
  const seen = new Set<string>(); let removed = false, replaying = true;
  function prune() { while (seen.size > 200) seen.delete(seen.values().next().value!); }
  function deliver(event: OpenRequest) {
    if (removed || seen.has(event.id)) return;
    seen.add(event.id); if (!replaying) prune();
    // A listener that throws must not abort the launch-queue replay for the rest of the batch.
    try { listener(event); } catch (cause) { console.error(new SparkError("E_NATIVE", "Open request listener failed", { cause })); }
  }
  const subscription = onDesktopEvent(event => {
    if (event.type !== "openURL" && event.type !== "openFile") return;
    let value: OpenRequest;
    try { value = request(event); } catch { return; }
    deliver(value);
  }, { types: ["openURL", "openFile"] });
  try {
    const values = await callAppNative("pendingURLs", (value): value is unknown[] => Array.isArray(value));
    const requests = values.map(request);
    for (const event of requests) deliver(event);
    replaying = false; prune();
  } catch (error) { removed = true; subscription.remove(); throw error; }
  return { remove() { if (!removed) { removed = true; subscription.remove(); } } };
}
