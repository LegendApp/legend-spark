import { expect, vi, test } from "vitest";
const { handlers, native } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => void>(),
  native: { startMonitoringKeyboard: vi.fn(async () => true), stopMonitoringKeyboard: vi.fn(async () => true), setConsumption: vi.fn(async (_id: string, _json: string, _capture: boolean) => true) },
}));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => native },
  NativeEventEmitter: class { addListener(name: string, handler: (event: unknown) => void) { handlers.set(name, handler); return { remove: () => { handlers.delete(name); } }; } },
}));
import { addKeyboardListener, createKeyboardConsumption } from "../packages/desktop-shortcuts/src/keyboard-manager/index";
const emit = (windowId: string | null) => handlers.get("onKeyDown")?.({ repeated: false, consumed: false, captured: false, key: "1", keyCode: 18, modifiers: 0, windowId });
test("window-scoped keyboard events skip unknown owners and the final removal stops monitoring", async () => {
  const listener = vi.fn(() => true), ids = ["slides-presenter", "slides-audience"];
  const registration = await addKeyboardListener("down", listener, { windowIds: ids }); ids.push("slides-settings");
  emit("slides-settings"); emit(null); expect(listener).not.toHaveBeenCalled();
  emit("slides-presenter"); emit("slides-audience"); expect(listener).toHaveBeenCalledTimes(2);
  expect(native.setConsumption).not.toHaveBeenCalled(); // Returned true is observation only.
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

test("native consumption owns monitoring, submits immutable rules, and permits removal retry", async () => {
  const rules = [{ key: "a", modifiers: 0, allowExtraModifiers: false, repeat: false }];
  const owner = await createKeyboardConsumption(rules);
  const [id, json, capturing] = native.setConsumption.mock.calls.at(-1)!;
  expect(JSON.parse(json)).toEqual(rules); expect(capturing).toBe(false);
  const second = await createKeyboardConsumption([], true);
  const secondId = native.setConsumption.mock.calls.at(-1)![0]; expect(secondId).not.toBe(id);
  const observer = await addKeyboardListener("down", () => {}); await observer.remove(); expect(handlers.size).toBe(2);
  const updating = owner.update(rules); rules[0]!.key = "b";
  expect(JSON.parse(native.setConsumption.mock.calls.at(-1)![1])[0].key).toBe("a"); await updating;
  native.setConsumption.mockRejectedValueOnce(Error("release failed"));
  const removal = owner.remove(); expect(owner.remove()).toBe(removal);
  await expect(removal).rejects.toMatchObject({ code: "E_NATIVE" });
  await expect(owner.update([])).rejects.toMatchObject({ code: "E_CLOSED" });
  await owner.remove(); expect(handlers.size).toBe(2);
  await second.remove(); expect(handlers.size).toBe(0);
});
