import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, Suspense } from "react";

const { create } = createRequire(import.meta.url)("react-test-renderer");
const mocks = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("../packages/desktop-windows/src/api", () => ({ addWindowListener: mocks.subscribe }));

import { WindowProvider } from "../packages/desktop-windows/src/windows/WindowProvider";
import { useWindowFocusEffect } from "../packages/desktop-windows/src/windows/useWindowFocusEffect";

let rendered: any;
let focusListener: ((event: { focused: boolean }) => void) | undefined;

function FocusEffect({ callback, onError, suspend }: { callback: () => void; onError?: (error: unknown) => void; suspend?: Promise<never> }) {
  useWindowFocusEffect(callback, { onError });
  if (suspend) throw suspend;
  return null;
}

function tree(callback: () => void, options: { onError?: (error: unknown) => void; suspend?: Promise<never> } = {}) {
  return React.createElement(WindowProvider, { id: "main", children: null },
    React.createElement(Suspense, { fallback: null }, React.createElement(FocusEffect, { callback, ...options })));
}

afterEach(async () => {
  if (rendered) { await act(async () => rendered.unmount()); rendered = undefined; }
  focusListener = undefined;
  mocks.subscribe.mockReset();
  vi.restoreAllMocks();
});

test("focus callback remains committed through suspended renders and updates after commit", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let remove: ReturnType<typeof vi.fn>;
  mocks.subscribe.mockImplementation(async (_id: string, _type: string, listener: (event: { focused: boolean }) => void) => {
    focusListener = listener;
    remove = vi.fn(async () => {});
    return { remove };
  });
  const committed = vi.fn(), abandoned = vi.fn(), nextCommitted = vi.fn();
  const pending = new Promise<never>(() => {});

  await act(async () => { rendered = create(tree(committed)); });
  await act(async () => { rendered.update(tree(abandoned, { suspend: pending })); });
  focusListener!({ focused: true });
  expect(committed).toHaveBeenCalledOnce();
  expect(abandoned).not.toHaveBeenCalled();

  await act(async () => { rendered.update(tree(nextCommitted)); });
  focusListener!({ focused: true });
  expect(committed).toHaveBeenCalledOnce();
  expect(nextCommitted).toHaveBeenCalledOnce();

  await act(async () => { rendered.unmount(); rendered = undefined; });
  expect(remove!).toHaveBeenCalledOnce();
});
