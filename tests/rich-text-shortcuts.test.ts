import React, { act, useRef } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { registerShortcut } = vi.hoisted(() => ({ registerShortcut: vi.fn() }));
vi.mock("@legendapp/spark-desktop-shortcuts", () => ({ registerShortcut }));
import { useInputShortcuts } from "../packages/rich-text/src/useInputShortcuts.macos";

let rendered: any;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  registerShortcut.mockReset();
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).startsWith("react-test-renderer is deprecated")) error(...args);
  });
});

test("macOS Escape registration that finishes after blur is removed and cannot dismiss another editor", async () => {
  let finish!: (value: { remove(): Promise<void> }) => void;
  registerShortcut.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const blur = vi.fn(),
    remove = vi.fn(async () => {});
  function Root({ focused }: { focused: boolean }) {
    const input = useRef({ focus: vi.fn(), blur });
    useInputShortcuts(input, focused);
    return null;
  }
  await act(async () => {
    rendered = create(React.createElement(Root, { focused: true }));
  });
  expect(registerShortcut.mock.calls[0][0]).toBe("Escape");
  const handler = registerShortcut.mock.calls[0][1];
  await act(async () => {
    rendered.update(React.createElement(Root, { focused: false }));
  });
  await act(async () => {
    finish({ remove });
  });
  handler();
  expect(blur).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledOnce();
});

test("focused formatting shortcuts use the committed callback and are removed on blur", async () => {
  const remove = vi.fn(async () => {}),
    first = vi.fn(),
    latest = vi.fn();
  registerShortcut.mockImplementation(async () => ({ remove }));
  function Root({ focused, onFormat }: { focused: boolean; onFormat(action: string): void }) {
    const input = useRef({ focus: vi.fn(), blur: vi.fn() });
    useInputShortcuts(input, focused, { onFormat, linkEnabled: true });
    return null;
  }
  await act(async () => {
    rendered = create(React.createElement(Root, { focused: true, onFormat: first }));
  });
  expect(registerShortcut.mock.calls.map((call) => call[0])).toEqual([
    "Escape",
    "Cmd+B",
    "Cmd+I",
    "Cmd+Shift+7",
    "Cmd+Shift+8",
    "Cmd+K",
  ]);
  const handler = registerShortcut.mock.calls[1][1];
  handler();
  expect(first).toHaveBeenCalledWith("bold");
  await act(async () => {
    rendered.update(React.createElement(Root, { focused: true, onFormat: latest }));
  });
  handler();
  expect(latest).toHaveBeenCalledWith("bold");
  expect(registerShortcut).toHaveBeenCalledTimes(6);
  await act(async () => {
    rendered.update(React.createElement(Root, { focused: false, onFormat: latest }));
  });
  expect(remove).toHaveBeenCalledTimes(6);
});
test("focus handoff waits for the previous editor's native shortcut removal", async () => {
  let finishRemoval!: () => void;
  const removing = new Promise<void>((resolve) => { finishRemoval = resolve; });
  const registered = new Set<string>();
  registerShortcut.mockImplementation(async (key: string) => {
    if (registered.has(key)) throw new Error("Shortcut is already registered in this scope");
    registered.add(key);
    return { remove: async () => { await removing; registered.delete(key); } };
  });
  const first = vi.fn(), second = vi.fn();
  function Editor({ focused, onFormat }: { focused: boolean; onFormat(action: string): void }) {
    const input = useRef({ focus: vi.fn(), blur: vi.fn() });
    useInputShortcuts(input, focused, { onFormat, linkEnabled: true });
    return null;
  }
  function Root({ secondFocused }: { secondFocused: boolean }) {
    return React.createElement(React.Fragment, null,
      React.createElement(Editor, { focused: !secondFocused, onFormat: first }),
      React.createElement(Editor, { focused: secondFocused, onFormat: second }),
    );
  }
  await act(async () => { rendered = create(React.createElement(Root, { secondFocused: false })); });
  const oldHandler = registerShortcut.mock.calls[1][1];
  await act(async () => { rendered.update(React.createElement(Root, { secondFocused: true })); });
  const callsBeforeRemoval = registerShortcut.mock.calls.length;
  await act(async () => { finishRemoval(); });
  expect(callsBeforeRemoval).toBe(6);
  expect(registerShortcut).toHaveBeenCalledTimes(12);
  oldHandler();
  registerShortcut.mock.calls[7][1]();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith("bold");
});

afterEach(async () => {
  if (rendered)
    await act(async () => {
      rendered.unmount();
    });
  rendered = undefined;
  vi.restoreAllMocks();
});
