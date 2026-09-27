import { beforeEach, expect, test, vi } from "vitest";
const { openWindow, closeWindow } = vi.hoisted(() => ({
  openWindow: vi.fn(async (_options: unknown) => ({ success: true })),
  closeWindow: vi.fn(async (_id: string) => ({ success: true })),
}));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, AppRegistry: { registerComponent: vi.fn() } }));
vi.mock("../packages/desktop-windows/src/api", () => ({ openWindow, closeWindow, showWindow: vi.fn() }));
import { createWindowsNavigator } from "../packages/desktop-windows/src/windows/createWindowsNavigator";
beforeEach(() => { vi.clearAllMocks(); });

test("a configured navigator window keeps its identity through open and close", async () => {
  const navigator = createWindowsNavigator({ editor: { component: () => null, id: "editor-window" } });
  await navigator.open("editor", { options: { title: "Document" } });
  expect(openWindow).toHaveBeenCalledWith(expect.objectContaining({ id: "editor-window", title: "Document" }));
  expect(navigator.getId("editor")).toBe("editor-window");
  await navigator.close("editor");
  expect(closeWindow).toHaveBeenCalledWith("editor-window");
});

test("identifier overrides reject before component loading or native window creation", async () => {
  const loadComponent = vi.fn(async () => () => null);
  const navigator = createWindowsNavigator({ editor: { id: "editor-override", loadComponent } });
  // Runtime coverage for JavaScript consumers, plus a compile-time contract check.
  // @ts-expect-error A named navigator window cannot change its identifier at open time.
  await expect(navigator.open("editor", { options: { id: "editor-2" } })).rejects.toThrow(/identity/i);
  expect(loadComponent).not.toHaveBeenCalled();
  expect(openWindow).not.toHaveBeenCalled();
  expect(navigator.getId("editor")).toBe("editor-override");
});
