import { beforeEach, expect, test, vi } from "vitest";
const { openWindow, closeWindow } = vi.hoisted(() => ({
  openWindow: vi.fn(async (_options: unknown) => ({ success: true })),
  closeWindow: vi.fn(async (_id: string) => ({ success: true })),
}));
vi.mock("react-native", () => ({ AppRegistry: { registerComponent: vi.fn() } }));
vi.mock("@legendapp/spark-desktop-windows/src/window-manager", () => ({ openWindow, closeWindow }));
import { createWindowsNavigator } from "../packages/desktop-windows/src/windows/createWindowsNavigator";
beforeEach(() => { vi.clearAllMocks(); });

test("a configured navigator window keeps its identity through open and close", async () => {
  const navigator = createWindowsNavigator({ editor: { component: () => null, identifier: "editor-window" } });
  await navigator.open("editor", { title: "Document" });
  expect(openWindow).toHaveBeenCalledWith(expect.objectContaining({ identifier: "editor-window", title: "Document" }));
  expect(navigator.getIdentifier("editor")).toBe("editor-window");
  await navigator.close("editor");
  expect(closeWindow).toHaveBeenCalledWith("editor-window");
});

test("identifier overrides reject before component loading or native window creation", async () => {
  const loadComponent = vi.fn(async () => () => null);
  const navigator = createWindowsNavigator({ editor: { loadComponent } });
  // Runtime coverage for JavaScript consumers, plus a compile-time contract check.
  // @ts-expect-error A named navigator window cannot change its identifier at open time.
  await expect(navigator.open("editor", { identifier: "editor-2" })).rejects.toThrow(/identifier/i);
  expect(loadComponent).not.toHaveBeenCalled();
  expect(openWindow).not.toHaveBeenCalled();
  expect(navigator.getIdentifier("editor")).toBe("editor");
});
