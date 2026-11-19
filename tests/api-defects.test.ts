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

test("navigator chrome overrides preserve registered window settings across opens", async () => {
  const navigator = createWindowsNavigator({
    player: {
      id: "nested-player",
      component: () => null,
      options: {
        title: "Player",
        macos: {
          restoreOnLaunch: true,
          titleBar: { transparent: true, titleVisibility: "hidden", controls: [{ id: "previous" }] },
          toolbar: { visible: true, items: [{ type: "button", id: "play" }] },
          tabbing: { mode: "preferred", identifier: "player" },
        },
      },
    },
  });

  await navigator.open("player", { options: { macos: {
    titleBar: { separator: "none", controls: [] },
    toolbar: { style: "unifiedCompact", items: [{ type: "button", id: "pause" }] },
    tabbing: { mode: "disallowed" },
  } } });
  expect(openWindow).toHaveBeenLastCalledWith(expect.objectContaining({
    title: "Player",
    macos: {
      restoreOnLaunch: true,
      titleBar: { transparent: true, titleVisibility: "hidden", separator: "none", controls: [] },
      toolbar: { visible: true, style: "unifiedCompact", items: [{ type: "button", id: "pause" }] },
      tabbing: { mode: "disallowed", identifier: "player" },
    },
  }));
  await navigator.close("player");
  await navigator.open("player");
  expect(openWindow).toHaveBeenLastCalledWith(expect.objectContaining({
    macos: {
      restoreOnLaunch: true,
      titleBar: { transparent: true, titleVisibility: "hidden", controls: [{ id: "previous" }] },
      toolbar: { visible: true, items: [{ type: "button", id: "play" }] },
      tabbing: { mode: "preferred", identifier: "player" },
    },
  }));
});

test("navigator explicit undefined clears only the specified defaults for that open", async () => {
  const navigator = createWindowsNavigator({
    player: {
      id: "clear-player",
      component: () => null,
      options: {
        title: "Player",
        macos: { restoreOnLaunch: true, titleBar: { transparent: true, titleVisibility: "hidden" }, toolbar: { visible: true } },
      },
    },
  });
  await navigator.open("player", { options: { title: undefined, macos: {
    titleBar: { titleVisibility: undefined },
    toolbar: undefined,
  } } });
  const [first] = openWindow.mock.lastCall!;
  expect(first).not.toHaveProperty("title");
  expect(first).toHaveProperty("macos", { restoreOnLaunch: true, titleBar: { transparent: true } });

  await navigator.open("player", { options: { macos: undefined } });
  const [second] = openWindow.mock.lastCall!;
  expect(second).toHaveProperty("title", "Player");
  expect(second).not.toHaveProperty("macos");
});
