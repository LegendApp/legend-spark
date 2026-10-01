import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { callLinks, linksCommand } from "@legendapp/spark-desktop-links/src/native";
import { openURL } from "@legendapp/spark-desktop-links";
import { subscribeToOpenRequests } from "@legendapp/spark-desktop-app/src/open-requests";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { toByteArray, fromByteArray } from "base64-js";
import { authSessions } from "./core";
import { validateCount, validateDigest, type CompleteAuthSessionResult } from "./types";
export type * from "./types";
export async function getRandomBytesAsync(count: number): Promise<Uint8Array> {
  validateCount(count);
  const base64 = await callLinks("cryptoRandom", { count }, (value): value is string => typeof value === "string" && value.length === Math.ceil(count / 3) * 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(value));
  const bytes = toByteArray(base64);
  if (bytes.length !== count || fromByteArray(bytes) !== base64) throw new SparkError("E_INVALID_DATA", "Native random bytes do not match the requested count");
  return bytes;
}
export async function digestStringAsync(algorithm: "SHA-256", value: string): Promise<string> {
  validateDigest(algorithm, value);
  return callLinks("cryptoDigest", { value }, (result): result is string => typeof result === "string" && /^[0-9a-f]{64}$/.test(result));
}
export const createAuthSession = authSessions({
  randomState: async () => Array.from(await getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, "0")).join(""),
  prepare: (id, port, path) => callLinks("authPrepare", { id, port, path }, (value): value is string => {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "http:" && url.hostname === "127.0.0.1" && Number(url.port) > 0 && (!port || Number(url.port) === port) && url.pathname === path && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }),
  subscribeLoopback: async (id, listener) => onDesktopEvent(event => {
    if (typeof event.url === "string") listener(event.url);
  }, { types: ["authRedirect"], target: { field: "id", value: id } }),
  close: id => linksCommand("authClose", { id }),
  subscribe: listener => subscribeToOpenRequests(event => { if (event.type === "url") listener(event.url); }),
  open: openURL,
});
/** Expo-compatible completion result: native hosts do not use a browser popup. */
export function maybeCompleteAuthSession(): CompleteAuthSessionResult { return { type: "failed", message: "Not supported on this platform" }; }
