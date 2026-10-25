import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const mocks = vi.hoisted(() => ({ setWindowOptions: vi.fn() }));
vi.mock("@legendapp/spark/system", () => ({
  getAppearancePreferences: () => new Promise(() => {}), getSystemAvailability: () => ({ available: true }),
  onSystemEvent: async () => ({ remove: async () => {} }),
}));
vi.mock("@legendapp/spark/windows", () => ({ setWindowOptions: mocks.setWindowOptions }));
import { useAppearancePreferences } from "../examples/kitchen-sink/screens/appearance-theming/useAppearancePreferences";

let screen: ReturnType<typeof useAppearancePreferences>, rendered: any;
function Root() { screen = useAppearancePreferences("main"); return null; }
async function mount() { await act(async () => { rendered = create(React.createElement(Root)); }); }
async function unmount() { await act(async () => { rendered.unmount(); rendered = undefined; }); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const appearances = () => mocks.setWindowOptions.mock.calls.map(([, options]) => options.appearance);
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.setWindowOptions.mockReset(); mocks.setWindowOptions.mockResolvedValue(undefined);
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await unmount(); vi.restoreAllMocks(); });

test("an override still in flight when the screen closes is reset once it lands", async () => {
  const dark = deferred();
  mocks.setWindowOptions.mockReturnValueOnce(dark.promise);
  await mount();
  act(() => screen.overrideWindow("dark"));
  await unmount();
  expect(appearances()).toEqual(["dark"]);
  dark.resolve();
  await vi.waitFor(() => expect(appearances()).toEqual(["dark", "system"]));
});

test("an override queued behind one in flight is dropped when the screen closes", async () => {
  const dark = deferred();
  mocks.setWindowOptions.mockReturnValueOnce(dark.promise);
  await mount();
  act(() => { screen.overrideWindow("dark"); screen.overrideWindow("light"); });
  await unmount();
  dark.resolve();
  await vi.waitFor(() => expect(appearances()).toEqual(["dark", "system"]));
});

test("closing after returning to the system appearance resets nothing", async () => {
  await mount();
  await act(async () => { screen.overrideWindow("dark"); screen.overrideWindow("system"); });
  expect(screen.windowAppearance).toBe("system");
  await unmount();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(appearances()).toEqual(["dark", "system"]);
});
