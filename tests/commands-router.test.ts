import { describe, it, expect, vi } from "vitest";
vi.mock("react-native", () => ({
  NativeEventEmitter: class { addListener() { return { remove() {} }; } },
  Platform: { OS: "macos" }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  TurboModuleRegistry: { getEnforcing: () => ({ startMonitoringKeyboard: async () => true, stopMonitoringKeyboard: async () => true, respondToKeyEvent() {} }) },
}));
vi.mock("@legendapp/spark-ui/src/sf-symbol", () => ({ SFSymbol: "SFSymbol" }));
const { mockKeyDownListeners, mockKeyUpListeners } = vi.hoisted(() => ({ mockKeyDownListeners: new Set<(event: any) => boolean | void>(), mockKeyUpListeners: new Set<(event: any) => boolean | void>() }));
vi.mock("@legendapp/spark-desktop-shortcuts/src/keyboard-manager", () => ({
  addKeyboardListener: async (type: string, listener: (event: any) => boolean | void) => {
    const listeners = type === "down" ? mockKeyDownListeners : mockKeyUpListeners;
    listeners.add(listener); return { async remove() { listeners.delete(listener); } };
  },
}));
import { createHotkeyRouter, type HotkeyDefinition } from "../packages/commands/src/index";
import { KeyCodes } from "../packages/desktop-shortcuts/src/keyboard-manager/codes";
function keyDown(keyCode: number, modifiers = 0) {
  for (const listener of mockKeyDownListeners) {
    listener({ keyCode, key: ({ 0: "a", 1: "s", 49: " ", 126: "\uf700" })[keyCode] ?? "", modifiers, windowId: null, eventId: "test" });
  }
}

function keyUp(keyCode: number, modifiers = 0) {
  for (const listener of mockKeyUpListeners) {
    listener({ keyCode, key: ({ 0: "a", 1: "s", 49: " ", 126: "\uf700" })[keyCode] ?? "", modifiers, windowId: null, eventId: "test" });
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

    router.setActiveWindowId("viewer-b");
    keyDown(KeyCodes.KEY_A);
    keyUp(KeyCodes.KEY_A);
    expect(windowHandler).not.toHaveBeenCalled();
    expect(applicationHandler).toHaveBeenCalledTimes(1);

    router.setActiveWindowId("viewer-a");
    const resume = router.suspend({ kind: "window", windowId: "viewer-a" });
    keyDown(KeyCodes.KEY_A);
    keyUp(KeyCodes.KEY_A);
    expect(windowHandler).not.toHaveBeenCalled();
    expect(applicationHandler).toHaveBeenCalledTimes(1);

    resume.remove();
    keyDown(KeyCodes.KEY_A);
    keyUp(KeyCodes.KEY_A);
    expect(windowHandler).toHaveBeenCalledTimes(1);
    expect(applicationHandler).toHaveBeenCalledTimes(1);

    await removeWindow.remove();
    await removeApplication.remove();
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
