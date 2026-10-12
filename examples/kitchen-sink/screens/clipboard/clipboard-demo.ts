import { useEffect, useRef, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import {
  StringFormat, clearClipboard, getClipboardChangeCount, getClipboardFormats, getRichClipboardAvailability, getStringAsync, hasStringAsync, onClipboardChange, readClipboard, setStringAsync,
  writeClipboard, writePromisedClipboard, type ClipboardDataType,
} from "@legendapp/spark/clipboard";
import type { AsyncRegistration } from "@legendapp/spark/contracts";

/** Availability readouts, keyed by the testID suffix that shows them. */
export function clipboardAvailability() {
  return {
    module: getRichClipboardAvailability(), "promised-data": getRichClipboardAvailability("promisedData"),
    "change-events": getRichClipboardAvailability("changeEvents"), "privacy-markers": getRichClipboardAvailability("privacyMarkers"),
  };
}
export const SAMPLE_TEXT = "Spark clipboard text";
const SAMPLE_HTML = "<p><b>Spark</b> clipboard</p>";
const SAMPLE_RTF = "{\\rtf1\\ansi {\\b Spark} clipboard}";
// A 1×1 PNG, produced only when a paste asks for it.
const SAMPLE_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), char => char.charCodeAt(0));
export const PROMISED_TYPES: readonly ClipboardDataType[] = ["text", "html", "png"];
/** How long the slow provider takes, beyond the 300 ms its paste waits. */
const SLOW_MS = 1500;

const describe = (value: unknown) => value instanceof SparkError ? `SparkError:${value.code}` : value instanceof Error ? `Error: ${value.message}` : String(value);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The Clipboard data screen's state and commands. Nothing touches the clipboard until a button asks; in the test
 * driver the module works on a private pasteboard, never the user's clipboard (docs/clipboard.md#testing).
 */
export function useClipboardDemo() {
  const [results, setResults] = useState<Record<string, string>>({});
  const [provided, setProvided] = useState<Record<ClipboardDataType, number>>({ text: 0, html: 0, rtf: 0, png: 0 });
  const [provideError, setProvideError] = useState<string | null>(null);
  const watcher = useClipboardChanges();
  const show = (id: string, value: string) => setResults(previous => ({ ...previous, [id]: value }));
  async function run(id: string, operation: () => Promise<unknown>) {
    try { const value = await operation(); show(id, value === undefined ? "resolved" : typeof value === "string" ? value : JSON.stringify(value)); }
    catch (cause) { show(id, describe(cause)); }
  }
  const count = (type: ClipboardDataType) => setProvided(previous => ({ ...previous, [type]: previous[type] + 1 }));
  const onError = (error: SparkError) => setProvideError(describe(error));
  return {
    results, provided, provideError, changes: watcher.changes,
    copyText: () => run("copy-text", () => setStringAsync(SAMPLE_TEXT)),
    copyRich: () => run("copy-rich", () => writeClipboard({ text: SAMPLE_TEXT, html: SAMPLE_HTML, rtf: SAMPLE_RTF })),
    copyConcealed: () => run("copy-concealed", () => writeClipboard({ text: "correct-horse-battery" }, { concealed: true })),
    copyTransient: () => run("copy-transient", () => writeClipboard({ text: "intermediate" }, { transient: true })),
    promise: () => run("promise", () => {
      setProvided({ text: 0, html: 0, rtf: 0, png: 0 }); setProvideError(null);
      return writePromisedClipboard({ types: PROMISED_TYPES, provide: type => { count(type); return type === "png" ? SAMPLE_PNG : type === "html" ? SAMPLE_HTML : SAMPLE_TEXT; } }, { onError });
    }),
    promiseSlow: () => run("promise-slow", () => {
      setProvideError(null);
      return writePromisedClipboard({ types: ["text"], provide: async () => { await sleep(SLOW_MS); return SAMPLE_TEXT; } }, { timeoutMs: 300, onError });
    }),
    promiseFailing: () => run("promise-failing", () => {
      setProvideError(null);
      return writePromisedClipboard({ types: ["text"], provide: () => { throw new Error("The document closed"); } }, { onError });
    }),
    read: () => run("read", async () => { const content = await readClipboard(); return { types: Object.keys(content).sort(), text: content.text ?? null }; }),
    getHtml: () => run("get-html", () => getStringAsync({ preferredFormat: StringFormat.HTML })),
    // AppKit lists legacy aliases (NSStringPboardType, …) beside each type; the readout keeps the uniform type identifiers.
    formats: () => run("formats", async () => (await getClipboardFormats()).filter(format => /^(public|org\.nspasteboard)\./.test(format))),
    hasText: () => run("has-text", async () => String(await hasStringAsync())),
    clear: () => run("clear", clearClipboard),
    changeCount: () => run("change-count", async () => String(await getClipboardChangeCount())),
    watch: () => run("watch", watcher.start),
    unwatch: () => run("watch", watcher.stop),
  };
}

/**
 * A clipboard change registration owned by the screen: started on request, removed on stop and on unmount. A
 * registration that completes after unmount, or after another start, is removed at once.
 */
function useClipboardChanges() {
  const [changes, setChanges] = useState<{ watching: boolean; events: number; changeCount: number | null }>({ watching: false, events: 0, changeCount: null });
  const owner = useRef<{ mounted: boolean; registration: AsyncRegistration | null }>({ mounted: true, registration: null });
  useEffect(() => {
    const state = owner.current;
    state.mounted = true;
    return () => { state.mounted = false; void state.registration?.remove(); state.registration = null; };
  }, []);
  return {
    changes,
    start: async () => {
      if (owner.current.registration) return;
      const registration = await onClipboardChange(event => setChanges(previous => ({ ...previous, events: previous.events + 1, changeCount: event.changeCount })), { intervalMs: 200 });
      if (!owner.current.mounted || owner.current.registration) { await registration.remove(); return; }
      owner.current.registration = registration;
      setChanges(previous => ({ ...previous, watching: true }));
    },
    stop: async () => {
      const registration = owner.current.registration;
      owner.current.registration = null;
      setChanges(previous => ({ ...previous, watching: false }));
      await registration?.remove();
    },
  };
}
