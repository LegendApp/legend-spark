import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const mocks = vi.hoisted(() => ({ register: vi.fn(), suspend: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => null }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } }));
import { useRoutedHotkeys, useHotkeySuspension, type HotkeyRegistrationState, type HotkeyRouter, type UseRoutedHotkeysOptions } from "../packages/commands/src/index";
const router: HotkeyRouter = { register: mocks.register, suspend: mocks.suspend, getPressedKeys: () => new Set(), setActiveWindowId() {} };
const definitions = [{ id: "open", title: "Open", defaultBindings: ["Cmd+O"] }];
const event = { repeated: false, consumed: true, captured: false, windowId: "main", keyCode: 31, key: "o", modifiers: 1 << 20 };
let state: HotkeyRegistrationState, rendered: any;
function Component(options: UseRoutedHotkeysOptions<string>) { state = useRoutedHotkeys(options); return null; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mocks.register.mockReset();
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) { await act(async () => rendered.unmount()); rendered = undefined; } vi.restoreAllMocks(); });
test("command hooks read the latest handlers without replacing registrations", async () => {
  const remove = vi.fn(async () => {}), first = vi.fn(), second = vi.fn(); mocks.register.mockResolvedValue({ remove, setEnabled: vi.fn(async () => {}) });
  await act(async () => { rendered = create(React.createElement(Component, { router, definitions, handlers: { open: first } })); });
  expect(state.status).toBe("ready");
  const options = mocks.register.mock.calls[0][0]; options.handlers.open({ event, binding: "Cmd+O", pressedKeys: new Set(), repeated: false }); expect(first).toHaveBeenCalledTimes(1);
  await act(async () => { rendered.update(React.createElement(Component, { router, definitions, handlers: { open: second } })); });
  options.handlers.open({ event, binding: "Cmd+O", pressedKeys: new Set(), repeated: false }); expect(second).toHaveBeenCalledTimes(1); expect(mocks.register).toHaveBeenCalledTimes(1);
  await act(async () => { rendered.unmount(); rendered = undefined; }); expect(remove).toHaveBeenCalledTimes(1);
});
test("unmount blocks callbacks before a pending registration resolves and disposes it late", async () => {
  let resolve!: (value: { remove(): Promise<void> }) => void;
  mocks.register.mockImplementation(() => new Promise(done => { resolve = done; })); const handler = vi.fn(), remove = vi.fn(async () => {});
  await act(async () => { rendered = create(React.createElement(Component, { router, definitions, handlers: { open: handler } })); });
  expect(state.status).toBe("loading"); const options = mocks.register.mock.calls[0][0];
  await act(async () => { rendered.unmount(); rendered = undefined; }); options.handlers.open({ event }); expect(handler).not.toHaveBeenCalled();
  await act(async () => { resolve({ remove }); }); expect(remove).toHaveBeenCalledTimes(1);
});
test("Strict Mode cleanup and failed disposal expose retry handles", async () => {
  const cleanup = vi.fn(), remove = vi.fn(async () => {}); mocks.register.mockResolvedValue({ remove, setEnabled: vi.fn(async () => {}) });
  await act(async () => { rendered = create(React.createElement(StrictMode, null, React.createElement(Component, { router, definitions, handlers: {}, onCleanupError: cleanup }))); });
  expect(mocks.register).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
  remove.mockRejectedValueOnce(Error("stop failed"));
  await act(async () => { rendered.unmount(); rendered = undefined; }); expect(cleanup).toHaveBeenCalledTimes(1);
  await cleanup.mock.calls[0][1].remove(); expect(remove).toHaveBeenCalledTimes(2);
});

import { createHotkeyRouter } from "../packages/commands/src/index";
test("command helpers import without native modules and registration reports unavailability", async () => {
  await expect(createHotkeyRouter().register({ definitions, handlers: {} })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});

test("enabled props update native state without replacing the owner, including changes during setup", async () => {
  const setEnabled = vi.fn(async (_enabled: boolean) => {}), remove = vi.fn(async () => {}), error = vi.fn();
  let resolve!: (handle: any) => void;
  mocks.register.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => { rendered = create(React.createElement(Component, { router, definitions, handlers: { open() {} }, enabled: true, onError: error })); });
  await act(async () => { rendered.update(React.createElement(Component, { router, definitions, handlers: { open() {} }, enabled: false, onError: error })); });
  await act(async () => { resolve({ remove, setEnabled }); });
  expect(setEnabled).toHaveBeenCalledWith(false); expect(state.status).toBe("ready"); expect(mocks.register).toHaveBeenCalledOnce();
  await act(async () => { rendered.update(React.createElement(Component, { router, definitions, handlers: { open() {} }, enabled: true, onError: error })); });
  expect(setEnabled).toHaveBeenLastCalledWith(true); expect(mocks.register).toHaveBeenCalledOnce();
  setEnabled.mockRejectedValueOnce(Error("native update failed"));
  await act(async () => { rendered.update(React.createElement(Component, { router, definitions, handlers: { open() {} }, enabled: false, onError: error })); });
  expect(state).toMatchObject({ status: "error", registration: { setEnabled } }); expect(error).toHaveBeenCalledOnce();
});
test("replacement waits for the previous native owner to finish removal", async () => {
  let release!: () => void;
  const remove = vi.fn(() => new Promise<void>(done => { release = done; }));
  mocks.register.mockResolvedValueOnce({ remove, setEnabled: vi.fn(async () => {}) }).mockResolvedValueOnce({ remove: vi.fn(async () => {}), setEnabled: vi.fn(async () => {}) });
  await act(async () => { rendered = create(React.createElement(Component, { router, definitions, handlers: { open() {} } })); });
  await act(async () => { rendered.update(React.createElement(Component, { router, definitions: [{ ...definitions[0], title: "Open File" }], handlers: { open() {} } })); });
  expect(remove).toHaveBeenCalledOnce(); expect(mocks.register).toHaveBeenCalledOnce();
  await act(async () => { release(); }); expect(mocks.register).toHaveBeenCalledTimes(2);
});

test("suspension removes late native registrations and reports setup failure", async () => {
  function Suspension({ active, onError }: { active: boolean; onError?: (error: unknown) => void }) { useHotkeySuspension({ active, router, onError }); return null; }
  let resolve!: (handle: any) => void;
  mocks.suspend.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const remove = vi.fn(async () => {});
  await act(async () => { rendered = create(React.createElement(Suspension, { active: true })); });
  await act(async () => { rendered.unmount(); rendered = undefined; });
  await act(async () => { resolve({ remove }); }); expect(remove).toHaveBeenCalledOnce();
  const error = vi.fn(); mocks.suspend.mockRejectedValueOnce(Error("cannot suspend"));
  await act(async () => { rendered = create(React.createElement(Suspension, { active: true, onError: error })); });
  expect(error).toHaveBeenCalledOnce();
});
test("inline definitions of equal content do not re-register", async () => {
  const remove = vi.fn(async () => {}); mocks.register.mockResolvedValue({ remove, setEnabled: vi.fn(async () => {}) });
  await act(async () => { rendered = create(React.createElement(Component, { router, definitions: [{ id: "open", title: "Open", defaultBindings: ["Cmd+O"] }], handlers: { open: () => {} } })); });
  expect(mocks.register).toHaveBeenCalledTimes(1);
  await act(async () => { rendered.update(React.createElement(Component, { router, definitions: [{ id: "open", title: "Open", defaultBindings: ["Cmd+O"] }], handlers: { open: () => {} } })); });
  expect(mocks.register, "equal definitions must not rebuild native keyboard consumption").toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
});
