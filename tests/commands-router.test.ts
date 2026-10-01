import { describe, it, expect, vi } from "vitest";
vi.mock("react-native", () => ({
  NativeEventEmitter: class { addListener() { return { remove() {} }; } },
  Platform: { OS: "macos" }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  TurboModuleRegistry: { getEnforcing: () => ({ startMonitoringKeyboard: async () => true, stopMonitoringKeyboard: async () => true, setConsumption: async () => true }) },
}));
vi.mock("@legendapp/spark-ui/src/sf-symbol", () => ({ SFSymbol: "SFSymbol" }));
const { mockKeyDownListeners, mockKeyUpListeners, consumption } = vi.hoisted(() => ({
  consumption: { update: vi.fn(async (_rules: unknown) => {}), remove: vi.fn(async () => {}), create: vi.fn() }, mockKeyDownListeners: new Set<(event: any) => boolean | void>(), mockKeyUpListeners: new Set<(event: any) => boolean | void>() }));
vi.mock("@legendapp/spark-desktop-shortcuts/src/keyboard-manager", () => ({
  createKeyboardConsumption: async (rules: unknown) => { consumption.create(rules); return { update: consumption.update, remove: consumption.remove }; },
  addKeyboardListener: async (type: string, listener: (event: any) => boolean | void) => {
    const listeners = type === "down" ? mockKeyDownListeners : mockKeyUpListeners;
    listeners.add(listener); return { async remove() { listeners.delete(listener); } };
  },
}));
import { createHotkeyRouter, type HotkeyDefinition } from "../packages/commands/src/index";
import { KeyCodes } from "../packages/desktop-shortcuts/src/keyboard-manager/codes";
import * as accelerator from "../packages/desktop-app/src/contracts/accelerator";
const held = new Set<number>(); let windowId: string | null = null;
function keyDown(keyCode: number, modifiers = 0) {
  const repeated = held.has(keyCode); held.add(keyCode);
  for (const listener of mockKeyDownListeners) {
    listener({ keyCode, key: ({ 0: "a", 1: "s", 49: " ", 126: "\uf700" })[keyCode] ?? "", modifiers, windowId, repeated, consumed: true, captured: false });
  }
}

function keyUp(keyCode: number, modifiers = 0) {
  held.delete(keyCode);
  for (const listener of mockKeyUpListeners) {
    listener({ keyCode, key: ({ 0: "a", 1: "s", 49: " ", 126: "\uf700" })[keyCode] ?? "", modifiers, windowId, repeated: false, consumed: true, captured: false });
  }
}

function definition(
  id: string,
  defaultBinding: string,
  options: Partial<HotkeyDefinition<string>> = {},
): HotkeyDefinition<string> {
  return {
    defaultBindings: [defaultBinding],
    id,
    title: id,
    ...options,
  };
}

describe("createHotkeyRouter", () => {
  it("publishes explicit enablement and preserves the last applied state after failure", async () => {
    const router = createHotkeyRouter(), handler = vi.fn();
    const registration = await router.register({ definitions: [definition("open", "A")], handlers: { open: handler }, enabled: false });
    expect(consumption.create).toHaveBeenLastCalledWith([]);
    keyDown(KeyCodes.KEY_A); keyUp(KeyCodes.KEY_A); expect(handler).not.toHaveBeenCalled();
    await registration.setEnabled(true); expect(consumption.update.mock.calls.at(-1)?.[0]).toMatchObject([{ key: "a", repeat: false }]);
    keyDown(KeyCodes.KEY_A); keyUp(KeyCodes.KEY_A); expect(handler).toHaveBeenCalledOnce();
    consumption.update.mockRejectedValueOnce(Error("update failed"));
    await expect(registration.setEnabled(false)).rejects.toThrow("update failed");
    keyDown(KeyCodes.KEY_A); keyUp(KeyCodes.KEY_A); expect(handler).toHaveBeenCalledTimes(2);
    await registration.setEnabled(false); expect(consumption.update).toHaveBeenLastCalledWith([]);
    await registration.remove(); await expect(registration.setEnabled(true)).rejects.toMatchObject({ code: "E_CLOSED" });
    await expect(router.register({ definitions: [], handlers: {}, enabled: (() => true) as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  });
  it("rolls overlapping enablement back to the last native publication", async () => {
    const router = createHotkeyRouter(), handler = vi.fn();
    const registration = await router.register({ definitions: [definition("open", "A")], handlers: { open: handler } });
    consumption.update.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("update failed"));
    const disable = registration.setEnabled(false), enable = registration.setEnabled(true);
    await disable; await expect(enable).rejects.toThrow("update failed");
    expect(consumption.update.mock.calls.at(-2)?.[0]).toMatchObject([{ key: "a" }]);
    keyDown(KeyCodes.KEY_A); keyUp(KeyCodes.KEY_A); expect(handler).toHaveBeenCalledOnce();
    await registration.remove();
  });
  it("restores a published disable when a later enablement fails", async () => {
    const router = createHotkeyRouter(), handler = vi.fn();
    const registration = await router.register({ definitions: [definition("open", "A")], handlers: { open: handler } });
    let finishDisable!: () => void;
    consumption.update.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finishDisable = resolve; }); }).mockRejectedValueOnce(Error("update failed"));
    const disable = registration.setEnabled(false);
    await vi.waitFor(() => expect(finishDisable).toBeTypeOf("function"));
    const enable = registration.setEnabled(true); finishDisable();
    await disable; await expect(enable).rejects.toThrow("update failed");
    keyDown(KeyCodes.KEY_A); keyUp(KeyCodes.KEY_A); expect(handler).not.toHaveBeenCalled();
    await registration.remove();
  });
  it("does not route unconsumed or captured observations", async () => {
    const router = createHotkeyRouter(), handler = vi.fn();
    const registration = await router.register({ definitions: [definition("open", "A")], handlers: { open: handler } });
    const event = { key: "a", keyCode: KeyCodes.KEY_A, modifiers: 0, windowId: null, repeated: false, consumed: false, captured: false };
    for (const listener of mockKeyDownListeners) { listener(event); listener({ ...event, consumed: true, captured: true }); }
    expect(handler).not.toHaveBeenCalled(); await registration.remove();
  });
  it("retries failed consumption cleanup before acquiring a replacement", async () => {
    const router = createHotkeyRouter(), options = { definitions: [definition("open", "A")], handlers: { open() {} } };
    const old = await router.register(options);
    consumption.remove.mockRejectedValueOnce(Error("release failed"));
    await expect(old.remove()).rejects.toThrow("release failed");
    const replacement = await router.register(options);
    expect(mockKeyDownListeners.size).toBe(1); expect(mockKeyUpListeners.size).toBe(1);
    await old.remove(); expect(mockKeyDownListeners.size).toBe(1); await replacement.remove();
  });
  it("compiles bindings once and dispatches without sorting or parsing accelerators", async () => {
    const router = createHotkeyRouter(), handler = vi.fn();
    const registration = await router.register({ definitions: [definition("constructor", "A")], handlers: { constructor: handler } });
    const parse = vi.spyOn(accelerator, "parseAccelerator"), sort = vi.spyOn(Array.prototype, "sort");
    try {
      keyDown(KeyCodes.KEY_A); keyUp(KeyCodes.KEY_A);
      keyDown(KeyCodes.KEY_A); keyUp(KeyCodes.KEY_A);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(parse).not.toHaveBeenCalled(); expect(sort).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); sort.mockRestore(); await registration.remove(); }
  });
  it("routes every configured binding for a command", async () => {
    const router = createHotkeyRouter();
    const handler = vi.fn();
    const remove = await router.register({
      bindings: {
        open: ["A", "S"],
      },
      definitions: [definition("open", "A")],
      handlers: { open: handler },
    });

    keyDown(KeyCodes.KEY_A);
    keyUp(KeyCodes.KEY_A);
    keyDown(KeyCodes.KEY_S);
    keyUp(KeyCodes.KEY_S);

    expect(handler).toHaveBeenCalledTimes(2);
    await remove.remove();
  });

  it("routes only the active window and honors window suspension", async () => {
    const router = createHotkeyRouter();
    const windowHandler = vi.fn();
    const applicationHandler = vi.fn();
    const definitions = [definition("open", "A")];
    const removeApplication = await router.register({
      definitions,
      handlers: { open: applicationHandler },
      scope: { kind: "application" },
    });
    const removeWindow = await router.register({
      definitions,
      handlers: { open: windowHandler },
      scope: { kind: "window", windowId: "viewer-a" },
    });

    windowId = "viewer-b"; router.setActiveWindowId(windowId);
    keyDown(KeyCodes.KEY_A);
    keyUp(KeyCodes.KEY_A);
    expect(windowHandler).not.toHaveBeenCalled();
    expect(applicationHandler).toHaveBeenCalledTimes(1);

    windowId = "viewer-a"; router.setActiveWindowId(windowId);
    const resume = await router.suspend({ kind: "window", windowId: "viewer-a" });
    expect(consumption.update.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ excludedWindowIds: ["viewer-a"] })]));
    keyDown(KeyCodes.KEY_A);
    keyUp(KeyCodes.KEY_A);
    expect(windowHandler).not.toHaveBeenCalled();
    expect(applicationHandler).toHaveBeenCalledTimes(1);

    await resume.remove();
    expect(consumption.update.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ excludedWindowIds: [] })]));
    keyDown(KeyCodes.KEY_A);
    keyUp(KeyCodes.KEY_A);
    expect(windowHandler).toHaveBeenCalledTimes(1);
    expect(applicationHandler).toHaveBeenCalledTimes(1);

    await removeWindow.remove();
    await removeApplication.remove(); windowId = null;
  });

  it("uses priority and handler consumption for overlapping bindings", async () => {
    const router = createHotkeyRouter();
    const calls: string[] = [];
    const definitions = [definition("space", "Space")];
    const removeFallback = await router.register({
      definitions,
      handlers: {
        space: () => {
          calls.push("fallback");
        },
      },
      priority: 100,
    });
    const removeControl = await router.register({
      definitions,
      handlers: {
        space: () => {
          calls.push("control");
          return false;
        },
      },
      priority: 200,
    });

    keyDown(KeyCodes.KEY_SPACE);
    keyUp(KeyCodes.KEY_SPACE);
    expect(calls).toEqual(["control", "fallback"]);

    await removeControl.remove();
    const removeConsumingControl = await router.register({
      definitions,
      handlers: {
        space: () => {
          calls.push("consumed");
        },
      },
      priority: 200,
    });
    keyDown(KeyCodes.KEY_SPACE);
    keyUp(KeyCodes.KEY_SPACE);
    expect(calls).toEqual(["control", "fallback", "consumed"]);

    await removeConsumingControl.remove();
    await removeFallback.remove();
  });

  it("dispatches repeated keydown events only for repeatable commands", async () => {
    const router = createHotkeyRouter();
    const normalHandler = vi.fn();
    const repeatHandler = vi.fn();
    const removeNormal = await router.register({
      definitions: [definition("normal", "A")],
      handlers: { normal: normalHandler },
      priority: 200,
    });
    const removeRepeat = await router.register({
      definitions: [definition("repeat", "A", { repeat: true })],
      handlers: {
        repeat: (context) => {
          repeatHandler(context.repeated);
          return false;
        },
      },
      priority: 300,
    });

    keyDown(KeyCodes.KEY_A);
    keyDown(KeyCodes.KEY_A);
    keyUp(KeyCodes.KEY_A);

    expect(repeatHandler).toHaveBeenNthCalledWith(1, false);
    expect(repeatHandler).toHaveBeenNthCalledWith(2, true);
    expect(normalHandler).toHaveBeenCalledTimes(1);
    await removeRepeat.remove();
    await removeNormal.remove();
  });

  it("provides pressed modifier state without accepting extra modifiers by default", async () => {
    const router = createHotkeyRouter();
    const exactHandler = vi.fn();
    const selectionHandler = vi.fn();
    const removeExact = await router.register({
      definitions: [definition("exact", "Up")],
      handlers: { exact: exactHandler },
      priority: 100,
    });
    const removeSelection = await router.register({
      definitions: [definition("selection", "Up", { allowExtraModifiers: true })],
      handlers: {
        selection: (context) => {
          selectionHandler(context.pressedKeys.has(KeyCodes.MODIFIER_SHIFT));
        },
      },
      priority: 200,
    });

    keyDown(KeyCodes.KEY_UP, KeyCodes.MODIFIER_SHIFT);
    keyUp(KeyCodes.KEY_UP, KeyCodes.MODIFIER_SHIFT);

    expect(selectionHandler).toHaveBeenCalledWith(true);
    expect(exactHandler).not.toHaveBeenCalled();
    expect(router.getPressedKeys().has(KeyCodes.KEY_UP)).toBe(false);
    await removeSelection.remove();
    await removeExact.remove();
  });
});
