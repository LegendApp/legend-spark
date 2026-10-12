import { expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ open: new Set<string>() }));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, NativeModules: {}, UIManager: {}, AppRegistry: { registerComponent: vi.fn() }, StyleSheet: { create: (styles: object) => styles, hairlineWidth: 1 }, View: "View", Text: "Text", Pressable: "Pressable", useColorScheme: () => "light" }));
vi.mock("../packages/desktop-windows/src/api", () => ({
  getWindowAvailability: () => ({ available: true }),
  openWindow: vi.fn(async (options: { id: string }) => { mocks.open.add(options.id); return { id: options.id }; }),
  closeWindow: vi.fn(async (id: string) => { mocks.open.delete(id); return { closed: true }; }),
  showWindow: vi.fn(async () => {}), getWindow: vi.fn(), setWindowOptions: vi.fn(),
  addWindowListener: vi.fn(async () => ({ remove: async () => {} })),
}));
vi.mock("../packages/desktop-windows/src/macos", () => ({ addMacOSWindowListener: vi.fn() }));
// The optional menu module is not installed.
vi.mock("@legendapp/spark-native-menu", () => { throw new Error("Cannot find module '@legendapp/spark-native-menu'"); });
import { createWindowsNavigator } from "../packages/desktop-windows/src/windows";

test("windows work without the native menu module; per-window menus reject E_MODULE_UNAVAILABLE and leave no window", async () => {
  const windows = createWindowsNavigator({ plain: { id: "menuless-plain", component: () => null }, menued: { component: () => null, menus: () => [] } });
  expect((await windows.open("plain")).id).toBe("menuless-plain");
  expect((await windows.openInstance("plain")).id).toBe("menuless-plain");
  await expect(windows.openInstance("menued")).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  expect(windows.list("menued")).toEqual([]); expect([...mocks.open]).toEqual(["menuless-plain"]);
  await windows.remove();
});
