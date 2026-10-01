import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const mocks = vi.hoisted(() => ({ down: new Set<(event: any) => void>(), up: new Set<(event: any) => void>(), capture: vi.fn(async () => ({ async remove() {} })) }));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } }));
vi.mock("@legendapp/spark-desktop-shortcuts/src/keyboard-manager", () => ({ createKeyboardConsumption: mocks.capture, addKeyboardListener: async (type: "down" | "up", handler: (event: any) => void) => { mocks[type].add(handler); return { async remove() { mocks[type].delete(handler); } }; } }));
import { HotkeyCapture } from "../packages/commands/src/index";
let rendered: any;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) { await act(async () => rendered.unmount()); rendered = undefined; } vi.restoreAllMocks(); });
test("capture owns listeners only while active and emits a canonical binding once on release", async () => {
  const changed = vi.fn(), capture = vi.fn();
  await act(async () => { rendered = create(React.createElement(HotkeyCapture, { value: null, onChange: changed, onCaptureChange: capture })); });
  expect(mocks.down.size).toBe(0); expect(capture).not.toHaveBeenCalled();
  await act(async () => rendered.root.findByType("Pressable").props.onPressIn());
  expect(mocks.capture).toHaveBeenCalledWith([], true); expect(mocks.down.size).toBe(1); expect(capture).toHaveBeenLastCalledWith(true);
  const event = { repeated: false, consumed: true, captured: true, windowId: "main", key: "s", keyCode: 1, modifiers: (1 << 20) | (1 << 17) };
  await act(async () => { for (const handler of mocks.down) handler(event); }); expect(changed).not.toHaveBeenCalled();
  await act(async () => { for (const handler of mocks.up) handler(event); });
  expect(changed).toHaveBeenCalledExactlyOnceWith("Cmd+Shift+S"); expect(capture.mock.calls).toEqual([[true], [false]]);
  expect(mocks.down.size).toBe(0); expect(mocks.up.size).toBe(0);
});
