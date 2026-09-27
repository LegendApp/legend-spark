import { expect, vi, test } from "vitest";
const { handlers, native } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => void>(),
  native: { startMonitoringKeyboard: vi.fn(async () => true), stopMonitoringKeyboard: vi.fn(async () => true), respondToKeyEvent: vi.fn() },
}));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => native },
  NativeEventEmitter: class { addListener(name: string, handler: (event: unknown) => void) { handlers.set(name, handler); return { remove: () => { handlers.delete(name); } }; } },
}));
import { addKeyboardListener } from "../packages/desktop-shortcuts/src/keyboard-manager/index";
const emit = (windowId: string | null) => handlers.get("onKeyDown")?.({ eventId: "key", key: "1", keyCode: 18, modifiers: 0, windowId });
test("window-scoped keyboard events skip unknown owners and the final removal stops monitoring", async () => {
  const listener = vi.fn(() => true), ids = ["slides-presenter", "slides-audience"];
  const registration = await addKeyboardListener("down", listener, { windowIds: ids }); ids.push("slides-settings");
  emit("slides-settings"); emit(null); expect(listener).not.toHaveBeenCalled();
  expect(native.respondToKeyEvent).toHaveBeenLastCalledWith("key", false);
  emit("slides-presenter"); emit("slides-audience"); expect(listener).toHaveBeenCalledTimes(2);
  expect(native.respondToKeyEvent).toHaveBeenLastCalledWith("key", true);
  const removing = registration.remove(); emit("slides-presenter"); expect(listener).toHaveBeenCalledTimes(2);
  await removing; expect(handlers.size).toBe(0); expect(native.stopMonitoringKeyboard).toHaveBeenCalledTimes(1);
});
test("failed monitor cleanup remains retryable and concurrent removals join", async () => {
  const registration = await addKeyboardListener("down", () => {});
  native.stopMonitoringKeyboard.mockRejectedValueOnce(Error("stop failed"));
  const first = registration.remove(); expect(registration.remove()).toBe(first);
  await expect(first).rejects.toMatchObject({ code: "E_NATIVE" }); expect(handlers.size).toBe(2);
  await registration.remove(); expect(handlers.size).toBe(0);
});
test("failed start does not retain JS observers", async () => {
  native.startMonitoringKeyboard.mockRejectedValueOnce(Error("start failed"));
  await expect(addKeyboardListener("down", () => {})).rejects.toMatchObject({ code: "E_NATIVE" }); expect(handlers.size).toBe(0);
});
