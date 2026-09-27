import { Platform } from "react-native";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { callAppNative } from "@legendapp/spark-desktop-app/src/transport";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import { SparkError, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { callLinks, linksCommand } from "./native";
export type URLListener = (event: { url: string }) => void;
function url(value: string) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "URL must include a scheme and contain no NUL");
  return value;
}
/** Selected Expo Linking contract: resolves true after native launch acceptance. */
export async function openURL(value: string): Promise<true> { await linksCommand("open", { url: url(value) }); return true; }
export function canOpenURL(value: string): Promise<boolean> {
  return Promise.resolve().then(() => callLinks("canOpen", { url: url(value) }, (value): value is boolean => typeof value === "boolean"));
}
/** Spark extension: open a local file or directory in its associated application. */
export async function openPath(path: string): Promise<void> { await linksCommand("openPath", { path: nativePath(path, Platform.OS) }); }
/** Stable native-process launch URL; later opens and JS reloads do not replace it. */
export function getInitialURL(): Promise<string | null> {
  return callAppNative("initialURL", (value): value is string | null => value === null || (typeof value === "string" && /^[a-z][a-z0-9+.-]*:/i.test(value) && !value.includes("\0")));
}
/** Live URL events only. Queued file/URL requests belong to app/documents. */
export function addEventListener(type: "url", listener: URLListener): Subscription {
  if (type !== "url" || typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a url event listener");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Desktop URL events require a desktop host");
  return onDesktopEvent(event => {
    if (event.type === "openURL" && event.initial !== true && typeof event.url === "string" && /^[a-z][a-z0-9+.-]*:/i.test(event.url) && !event.url.includes("\0")) listener({ url: event.url });
  });
}
