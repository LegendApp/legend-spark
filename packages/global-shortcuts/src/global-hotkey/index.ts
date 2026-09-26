import { Platform } from "react-native";
import { onDesktopEvent } from "@legendapp/spark-desktop-app";
import Native from "../NativeDesktopGlobalShortcuts";
export type GlobalHotkeyResult = { success: boolean; message?: string };
const listeners = new Set<() => void>();
const id = "spark.primary-hotkey";
let subscription: { remove(): void } | undefined;
let queue = Promise.resolve<GlobalHotkeyResult>({ success: true });
function enqueue(action: () => Promise<void>) {
  queue = queue.then(action, action).then(() => ({ success: true }), error => ({ success: false, message: error instanceof Error ? error.message : String(error) }));
  return queue;
}
async function remove() {
  if (subscription) {
    await Native.call("remove", JSON.stringify({ id }));
    subscription.remove(); subscription = undefined;
  }
}
export function registerGlobalHotkey(keyCode: number, modifiers = 0) {
  return enqueue(async () => {
    if (Platform.OS !== "macos") throw new Error("Key-code hotkeys require macOS; use registerGlobalShortcut on other desktops");
    if (!Number.isInteger(keyCode) || keyCode < 0 || keyCode > 255 || !Number.isInteger(modifiers)) throw new TypeError("Invalid key code or modifiers");
    await remove();
    const next = onDesktopEvent(event => { if (event.type === "globalShortcut" && event.id === id) for (const listener of listeners) listener(); });
    try { await Native.call("register", JSON.stringify({ id, keyCode, modifiers })); subscription = next; }
    catch (error) { next.remove(); throw error; }
  });
}
export function unregisterGlobalHotkey() { return enqueue(remove); }
export function addGlobalHotkeyListener(listener: () => void) {
  listeners.add(listener);
  return { remove() { listeners.delete(listener); } };
}
