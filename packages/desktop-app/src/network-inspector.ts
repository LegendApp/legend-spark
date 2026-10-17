import { Platform } from "react-native";
import { SparkError, type Subscription } from "./contracts";
import type { DevToolsAvailability } from "./devtools";

// The network inspector's public surface. Release-safe: the inspector itself (interception, the log, the DevTools
// channel) lives in ./network-inspector/, which @legendapp/spark/runtime-entry requires only in development bundles
// and which registers itself here (docs/devtools.md#network-inspector).

/** Who made a request: React Native's fetch, an XMLHttpRequest, or a WebSocket. */
export type NetworkSource = "fetch" | "xhr" | "websocket";
/**
 * A captured body or WebSocket frame payload. `data` is text, or base64 when `base64` (binary data and blob bodies);
 * `size` is the whole body's length (bytes, or characters of a text body) and `truncated` says `data` holds only its
 * first `maxBodySize`. `data` is absent when the body could not be read (a blob released before the inspector read it),
 * and `data` and `size` both for a FormData or file upload.
 */
export interface NetworkBody { data?: string; base64: boolean; size?: number; truncated: boolean }
/** One captured WebSocket frame. `opcode` is 1 for text and 2 for binary; `at` is milliseconds since the epoch. */
export interface NetworkFrame extends NetworkBody { direction: "sent" | "received"; opcode: 1 | 2; at: number }
/** A call frame of the code that started the request. Lines and columns count from 1. */
export interface NetworkCallFrame { functionName: string; url: string; line: number; column: number }
/**
 * One request or WebSocket. Headers named in `redactHeaders` read `[redacted]`. Times are milliseconds since the epoch.
 * `state`: an HTTP request is `pending`, then `finished`, `failed` or `canceled`; a WebSocket is `pending` until it
 * opens, `open`, then `closed` or `failed`.
 */
export interface NetworkEntry {
  id: string;
  source: NetworkSource;
  method: string;
  url: string;
  requestHeaders: Readonly<Record<string, string>>;
  requestBody?: NetworkBody;
  initiator: readonly NetworkCallFrame[];
  state: "pending" | "open" | "finished" | "failed" | "canceled" | "closed";
  startedAt: number;
  respondedAt?: number;
  endedAt?: number;
  /** HTTP status; 101 for an open WebSocket. */
  status?: number;
  /** The URL that answered, after redirects. */
  responseURL?: string;
  responseHeaders?: Readonly<Record<string, string>>;
  responseBody?: NetworkBody;
  /** WebSocket frames, the latest 50. */
  frames?: readonly NetworkFrame[];
  /** WebSocket close code and reason. */
  close?: { code: number; reason: string };
  error?: string;
}
/** Options for `configureNetworkInspector`. */
export interface NetworkInspectorOptions {
  /** Header names (any case) whose values are replaced by `[redacted]`. Default: Authorization, Cookie, Set-Cookie. */
  redactHeaders?: readonly string[];
  /** Entries the log keeps; the oldest go first. Default 100. */
  maxEntries?: number;
  /** Bytes (characters for text) kept of each body and frame. Default 65536. */
  maxBodySize?: number;
  /** Bytes of URLs, headers, bodies and frames the log keeps in all; the oldest entries go first. Default 4 MiB. */
  maxLogSize?: number;
}

/** Internal: what ./network-inspector registers. */
export interface NetworkInspector {
  addListener(listener: (entry: NetworkEntry) => void): Subscription;
  log(): readonly NetworkEntry[];
  configure(options: NetworkInspectorOptions): void;
}
let inspector: NetworkInspector | undefined;
/** Internal, development bundles only: one inspector per JavaScript runtime. */
export function registerNetworkInspector(implementation: NetworkInspector): void {
  if (inspector) throw new SparkError("E_ALREADY_EXISTS", "A network inspector is already registered");
  inspector = implementation;
}

/**
 * The network inspector exists on macOS in development bundles, in every JavaScript runtime, once
 * `@legendapp/spark/runtime-entry` has installed it (`missing-module` otherwise). Release bundles contain none of it.
 */
export function getNetworkInspectorAvailability(): DevToolsAvailability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  if (!__DEV__) return { available: false, reason: "development-only" };
  return inspector ? { available: true } : { available: false, reason: "missing-module" };
}
const codes = { "unsupported-platform": "E_UNSUPPORTED_PLATFORM", "missing-module": "E_MODULE_UNAVAILABLE", "host-restriction": "E_UNAVAILABLE", "development-only": "E_UNAVAILABLE" } as const;
function available(): NetworkInspector {
  const availability = getNetworkInspectorAvailability();
  if (!availability.available) throw new SparkError(codes[availability.reason], "The network inspector is unavailable: " + availability.reason);
  return inspector!;
}

/**
 * Calls `listener` with each new or changed entry of this runtime's requests. The inspector records while a listener
 * is registered or React Native DevTools is attached to the runtime, and does nothing otherwise.
 */
export function addNetworkListener(listener: (entry: NetworkEntry) => void): Subscription {
  if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a network listener");
  return available().addListener(listener);
}
/** The entries recorded so far, oldest first; the same array until an entry changes. Empty while nothing observes. */
export function getNetworkLog(): readonly NetworkEntry[] { return available().log(); }
/** Changes the given options; the others keep their values. Lower limits apply at once. */
export function configureNetworkInspector(options: NetworkInspectorOptions): void { available().configure(options); }
