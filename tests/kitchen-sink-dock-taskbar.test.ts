import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const mocks = vi.hoisted(() => ({ createDockMenu: vi.fn(), requestAttention: vi.fn(), setAppBadge: vi.fn(async () => {}), setAppProgress: vi.fn(async () => {}) }));
vi.mock("react-native", () => ({ Platform: { OS: "macos" } }));
vi.mock("@legendapp/spark/system", () => ({
  createDockMenu: mocks.createDockMenu, createTaskbarMenu: vi.fn(), getSystemAvailability: () => ({ available: true }),
  requestAttention: mocks.requestAttention, setAppBadge: mocks.setAppBadge, setAppProgress: mocks.setAppProgress,
}));
import { useDockTaskbarDemo } from "../examples/kitchen-sink/screens/system-integration/dock-taskbar-demo";
import type { DockTaskbarMessages } from "../examples/kitchen-sink/screens/system-integration/dock-taskbar-messages";

const t = { badgeText: "New", menu: {} } as DockTaskbarMessages;
let demo: ReturnType<typeof useDockTaskbarDemo>, rendered: any;
function Root() { demo = useDockTaskbarDemo(t); return null; }
async function mount() { await act(async () => { rendered = create(React.createElement(Root)); }); }
async function unmount() { await act(async () => { rendered.unmount(); rendered = undefined; }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  mocks.createDockMenu.mockReset(); mocks.requestAttention.mockReset(); mocks.setAppBadge.mockClear(); mocks.setAppProgress.mockClear();
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await unmount(); vi.useRealTimers(); vi.restoreAllMocks(); });

test("Stop during the attention delay settles the request as cancelled without requesting attention", async () => {
  await mount();
  let request!: Promise<void>;
  await act(async () => { request = demo.run("attention-critical"); });
  await act(async () => demo.run("attention-stop"));
  await act(async () => { await request; });
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(demo.results).toMatchObject({ "attention-critical": "cancelled", "attention-stop": "cancelled" });
  expect(mocks.requestAttention).not.toHaveBeenCalled();
});

test("an attention registration that arrives after unmount is removed", async () => {
  const remove = vi.fn(async () => {});
  let finish!: (registration: { remove: () => Promise<void> }) => void;
  mocks.requestAttention.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  let request!: Promise<void>;
  await act(async () => { request = demo.run("attention-critical"); });
  await act(async () => { vi.advanceTimersByTime(3000); });
  expect(mocks.requestAttention).toHaveBeenCalledWith({ kind: "critical" });
  await unmount();
  finish({ remove });
  await request;
  expect(remove).toHaveBeenCalledTimes(1);
});

test("an attention registration that arrives after Stop is removed", async () => {
  const remove = vi.fn(async () => {});
  let finish!: (registration: { remove: () => Promise<void> }) => void;
  mocks.requestAttention.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  let request!: Promise<void>;
  await act(async () => { request = demo.run("attention-informational"); });
  await act(async () => { vi.advanceTimersByTime(3000); });
  await act(async () => demo.run("attention-stop"));
  await act(async () => { finish({ remove }); await request; });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(demo.results["attention-informational"]).toBe("cancelled");
});

test("unmount clears only the badge and progress this screen set", async () => {
  await mount();
  await unmount();
  expect(mocks.setAppBadge).not.toHaveBeenCalled();
  expect(mocks.setAppProgress).not.toHaveBeenCalled();
  await mount();
  await act(async () => demo.run("badge-count"));
  await unmount();
  expect(mocks.setAppBadge.mock.calls).toEqual([[3], [""]]);
  expect(mocks.setAppProgress).not.toHaveBeenCalled();
  mocks.setAppBadge.mockClear();
  await mount();
  await act(async () => demo.run("progress-35"));
  await act(async () => demo.run("progress-clear"));
  await unmount();
  expect(mocks.setAppProgress.mock.calls).toEqual([[{ state: "normal", value: 0.35 }], [null]]);
  expect(mocks.setAppBadge).not.toHaveBeenCalled();
});

function pendingDockMenu() {
  const remove = vi.fn(async () => {});
  let finish!: (registration: { remove: () => Promise<void> }) => void;
  mocks.createDockMenu.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  return { remove, finish: () => finish({ remove }) };
}

test("a Dock menu that arrives after unmount is removed", async () => {
  const menu = pendingDockMenu();
  await mount();
  let install!: Promise<void>;
  await act(async () => { install = demo.run("launcher-install"); });
  await unmount();
  menu.finish();
  await install;
  await vi.waitFor(() => expect(menu.remove).toHaveBeenCalledTimes(1));
});

test("Remove while the Dock menu is being created removes it once it arrives", async () => {
  const menu = pendingDockMenu();
  await mount();
  let install!: Promise<void>, remove!: Promise<void>;
  await act(async () => { install = demo.run("launcher-install"); });
  await act(async () => { remove = demo.run("launcher-remove"); });
  await act(async () => { menu.finish(); await install; await remove; });
  expect(menu.remove).toHaveBeenCalledTimes(1);
  expect(demo.results).toMatchObject({ "launcher-install": "installed", "launcher-remove": "removed" });
  await unmount();
  expect(menu.remove).toHaveBeenCalledTimes(1);
});

test("a failed Dock menu removal keeps the menu so Remove can retry it", async () => {
  const menu = pendingDockMenu();
  menu.remove.mockRejectedValueOnce(new Error("busy"));
  await mount();
  await act(async () => { const install = demo.run("launcher-install"); menu.finish(); await install; });
  await act(async () => demo.run("launcher-remove"));
  expect(demo.results["launcher-remove"]).toBe("Error: busy");
  await act(async () => demo.run("launcher-remove"));
  expect(demo.results["launcher-remove"]).toBe("removed");
  expect(menu.remove).toHaveBeenCalledTimes(2);
  await unmount();
  expect(menu.remove).toHaveBeenCalledTimes(2);
});

test("installing twice creates one Dock menu, and a failed creation can be retried", async () => {
  mocks.createDockMenu.mockRejectedValueOnce(new Error("no dock"));
  await mount();
  await act(async () => demo.run("launcher-install"));
  expect(demo.results["launcher-install"]).toBe("Error: no dock");
  const menu = pendingDockMenu();
  await act(async () => { const first = demo.run("launcher-install"), second = demo.run("launcher-install"); menu.finish(); await first; await second; });
  expect(mocks.createDockMenu).toHaveBeenCalledTimes(2);
  expect(demo.results["launcher-install"]).toBe("installed");
});
