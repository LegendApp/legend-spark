import { beforeEach, expect, test, vi } from "vitest";

const { values, nativeStorage, openWindow, closeWindow } = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    nativeStorage: {
      getStoragePathUri: (_root: string, path: string) => `/data/${path}`,
      readStorageText: (_root: string, path: string) => values.get(path) ?? null,
      deleteStoragePath: vi.fn((_root: string, path: string) => values.delete(path)),
      writeStorageText: vi.fn((_root: string, path: string, value: string) => { values.set(path, value); return true; }),
    },
    openWindow: vi.fn(async (_options: unknown) => ({ success: true })),
    closeWindow: vi.fn(async (_id: string) => ({ success: true })),
  };
});
vi.mock("../packages/settings/src/storage/NativeStorage", () => ({ default: nativeStorage }));
vi.mock("react-native", () => ({ AppRegistry: { registerComponent: vi.fn() } }));
vi.mock("@legendapp/spark-desktop-windows/src/window-manager", () => ({ openWindow, closeWindow }));
import { createStorage } from "../packages/settings/src/storage/index";
import { createWindowsNavigator } from "../packages/desktop-windows/src/windows/createWindowsNavigator";

beforeEach(() => { values.clear(); vi.clearAllMocks(); });

test.each(["{broken", "", "undefined"])("invalid JSON %j throws without deleting or replacing stored bytes", content => {
  const storage = createStorage();
  values.set("settings.json", content);
  expect(() => storage.read("settings.json", { format: "json" })).toThrow();
  expect(values.get("settings.json")).toBe(content);
  expect(nativeStorage.deleteStoragePath).not.toHaveBeenCalled();
  expect(nativeStorage.writeStorageText).not.toHaveBeenCalled();
  storage.write("settings.json", { repaired: true }, { format: "json" });
  expect(storage.read("settings.json", { format: "json" })).toEqual({ repaired: true });
});

test("missing files, JSON null/false and empty text retain their distinct results", () => {
  const storage = createStorage();
  expect(storage.read("missing.json", { format: "json" })).toBeUndefined();
  for (const value of [null, false, 0, "", { saved: true }]) {
    values.set("settings.json", JSON.stringify(value));
    expect(storage.read("settings.json", { format: "json" })).toEqual(value);
  }
  values.set("empty.txt", "");
  expect(storage.read("empty.txt", { format: "text" })).toBe("");
});

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
