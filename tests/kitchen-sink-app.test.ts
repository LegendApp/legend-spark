import { createRequire } from "node:module";
import React, { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");

const spark = vi.hoisted(() => ({
  args: [] as string[],
  locale: undefined as unknown as () => Promise<string>,
  menu: undefined as unknown as () => Promise<{ remove(): Promise<void> }>,
  createMenu: undefined as any, registerShortcut: undefined as any, beforeQuit: undefined as any, beforeWindowClose: undefined as any,
  alert: undefined as any, openFileDialog: undefined as any, saveFileDialog: undefined as any, readText: undefined as any, writeText: undefined as any,
}));
function resetSpark() {
  const registration = () => Promise.resolve({ remove: async () => {} });
  Object.assign(spark, {
    args: [], locale: async () => "en_US", menu: registration,
    createMenu: vi.fn(() => spark.menu()), registerShortcut: vi.fn(registration), beforeQuit: vi.fn(registration), beforeWindowClose: vi.fn(registration),
    alert: vi.fn(), openFileDialog: vi.fn(async () => ({ canceled: false, paths: ["/tmp/notes.txt"] })), saveFileDialog: vi.fn(),
    readText: vi.fn(async () => "Saved text"), writeText: vi.fn(async () => {}),
  });
}
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", Alert: { alert: (...args: unknown[]) => spark.alert(...args) } }));
vi.mock("uniwind", () => ({ Uniwind: { setTheme: () => {} }, useUniwind: () => ({ theme: "light", hasAdaptiveThemes: true }) }));
vi.mock("@legendapp/spark/ui/uniwind", () => ({ Button: "Button" }));
vi.mock("@legendapp/spark/app", () => ({ getAppContext: async () => ({ launchArguments: spark.args }), beforeQuit: (handler: unknown) => spark.beforeQuit(handler) }));
vi.mock("@legendapp/spark/app/documents", () => ({ noteRecentDocument: async () => {} }));
vi.mock("@legendapp/spark/dialogs", () => ({ openFileDialog: (options: unknown) => spark.openFileDialog(options), saveFileDialog: (options: unknown) => spark.saveFileDialog(options) }));
vi.mock("@legendapp/spark/files", () => ({ readText: (path: string) => spark.readText(path), writeText: (path: string, text: string) => spark.writeText(path, text) }));
vi.mock("@legendapp/spark/menus", () => ({ createMenu: (options: unknown) => spark.createMenu(options) }));
vi.mock("@legendapp/spark/shortcuts", () => ({ registerShortcut: (accelerator: string, handler: unknown) => spark.registerShortcut(accelerator, handler) }));
vi.mock("@legendapp/spark/system", () => ({ getSystemInfo: async () => ({ locale: await spark.locale() }) }));
vi.mock("@legendapp/spark/windows", () => ({ beforeWindowClose: (id: string, handler: unknown) => spark.beforeWindowClose(id, handler) }));
vi.mock("@legendapp/spark/links", () => ({ addEventListener: () => ({ remove() {} }), getInitialURL: async () => null }));
// require.context is Metro-only; register a fixture area the way screens/<area>/index.tsx does.
vi.mock("../examples/kitchen-sink/shell/catalog", async () => {
  const { createCatalog, defineScreens } = await import("../examples/kitchen-sink/shell/registry.ts");
  const component = () => React.createElement("Text", null, "Frame screen body");
  return { catalog: createCatalog([["./windows/index.tsx", { default: defineScreens("windows", [{ id: "frame", title: "Frame", summary: "Frame summary", component }]) }]]) };
});

let rendered: any;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; resetSpark(); vi.resetModules();
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });

async function start() {
  const controller = await import("../examples/kitchen-sink/shell/app-controller.ts");
  const navigation = await import("../examples/kitchen-sink/shell/navigation.ts");
  const { Shell } = await import("../examples/kitchen-sink/shell/Shell.tsx");
  await controller.startAppController();
  return { controller, navigation, Shell };
}
async function mount(Shell: React.ComponentType<{ mode?: string; projectId?: string }>) {
  await act(async () => { rendered = create(React.createElement(Shell, { mode: "dev", projectId: "ks" })); });
}
const host = (testID: string) => rendered.root.findAll((node: any) => typeof node.type === "string" && node.props.testID === testID);
const text = (node: any): string => node.children.map((child: any) => typeof child === "string" ? child : text(child)).join("");
const texts = () => rendered.root.findAll((node: any) => node.type === "Text").map(text);

test("the Shell renders Arabic right to left, with a mirrored breadcrumb and the screen's root testID", async () => {
  spark.locale = async () => "ar_EG";
  const { navigation, Shell } = await start();
  await mount(Shell);
  expect(host("infra-shell-root")[0].props.style).toEqual({ direction: "rtl" });
  expect(texts()).toContain("كل الشاشات");
  expect(text(host("infra-shell-theme-toggle")[0])).toBe("المظهر: النظام ← فاتح");
  expect(host("infra-shell-area-windows")[0].props.accessibilityLabel).toBe("النوافذ، شاشة واحدة");
  await act(async () => navigation.navigate({ kind: "screen", area: "windows", screen: "frame" }));
  expect(host("infra-shell-breadcrumb-separator").map(text)).toEqual(["‹", "‹"]);
  expect(text(host("infra-shell-breadcrumb")[0])).toContain("النوافذ");
  expect(text(host("windows-frame-root")[0])).toBe("Frame screen body");
});

test("the Shell renders English left to right and explains links that open no screen", async () => {
  const { navigation, Shell } = await start();
  await mount(Shell);
  expect(host("infra-shell-root")[0].props.style).toEqual({ direction: "ltr" });
  expect(texts()).toContain("dev · ks");
  expect(texts()).toContain("1 of 37 areas have screens. Every screen opens from spark-ks://<area>/<screen>.");
  await act(async () => host("infra-shell-screen-windows-frame")[0].props.onPress());
  expect(host("infra-shell-breadcrumb-separator").map(text)).toEqual(["›", "›"]);
  expect(host("windows-frame-root")).toHaveLength(1);
  await act(async () => navigation.openLink("spark-ks://windows/missing"));
  expect(host("windows-frame-root")).toHaveLength(0);
  expect(text(host("infra-shell-not-found-reason")[0])).toBe('Windows has no screen named "missing".');
  await act(async () => navigation.openLink("https://example.com"));
  expect(text(host("infra-shell-not-found-reason")[0])).toBe("Only spark-ks:// links open Kitchen Sink screens.");
  await act(async () => navigation.openLink("spark-ks://menus"));
  expect(text(host("infra-shell-area-empty")[0])).toBe("No screens registered yet. Add them in screens/menus/index.tsx.");
});

test("the Shell waits for the locale and shows a startup failure", async () => {
  spark.locale = async () => { throw new Error("System module unavailable"); };
  const { Shell } = await start();
  await mount(Shell);
  expect(host("infra-shell-root")).toHaveLength(0);
  expect(host("infra-shell-starting")).toHaveLength(1);
  expect(text(host("infra-shell-error")[0])).toBe("System module unavailable");
});

test("app-wide registrations install at startup, localized, and failures reach the Shell", async () => {
  spark.locale = async () => "ar";
  spark.menu = async () => { throw new Error("Menu owner kitchen-sink already exists"); };
  const { Shell } = await start();
  expect(spark.createMenu).toHaveBeenCalledTimes(1);
  const [{ id, items }] = spark.createMenu.mock.calls[0];
  expect(id).toBe("kitchen-sink");
  expect(items).toEqual([{ type: "submenu", id: "document", label: "المستند", items: [{ type: "action", id: "open", label: "فتح…", shortcut: "CmdOrCtrl+O" }, { type: "action", id: "save", label: "حفظ…", shortcut: "CmdOrCtrl+S" }] }]);
  expect(spark.registerShortcut).toHaveBeenCalledWith("Command+Shift+K", expect.any(Function));
  expect(spark.beforeQuit).toHaveBeenCalledTimes(1);
  expect(spark.beforeWindowClose).toHaveBeenCalledWith("main", spark.beforeQuit.mock.calls[0][0]);
  await mount(Shell);
  expect(text(host("infra-shell-error")[0])).toBe("تعذّر إعداد Kitchen Sink: Menu owner kitchen-sink already exists");
});

test("the Document menu and ⌘⇧K act on the app-wide document; unsaved edits prompt before quit", async () => {
  const { controller } = await start();
  const { onAction } = spark.createMenu.mock.calls[0][0];
  const confirm = spark.beforeQuit.mock.calls[0][0];
  // The untitled starter document has never been saved.
  const untitled = confirm();
  spark.alert.mock.calls[0][2].find((button: any) => button.text === "Discard").onPress();
  await expect(untitled).resolves.toBe(true);
  onAction({ type: "action", itemId: "open" });
  await vi.waitFor(() => expect(controller.getAppState().document).toEqual({ path: "/tmp/notes.txt", text: "Saved text", saved: "Saved text" }));
  expect(confirm()).toBe(true);
  expect(spark.openFileDialog).toHaveBeenCalledWith({ title: "Open a text document", filters: [{ extensions: ["txt", "md", "json"] }], multiple: false });
  spark.registerShortcut.mock.calls[0][1]();
  expect(controller.getAppState().menuEvents.map(entry => entry.text)).toEqual(["Document menu: open", "Shortcut fired: Command+Shift+K"]);
  controller.setDocumentText("Edited");
  const decision = confirm();
  expect(spark.alert).toHaveBeenLastCalledWith("Unsaved document", "Discard your changes?", expect.any(Array));
  spark.alert.mock.calls[1][2].find((button: any) => button.text === "Keep editing").onPress();
  await expect(decision).resolves.toBe(false);
  onAction({ type: "action", itemId: "save" });
  await vi.waitFor(() => expect(spark.writeText).toHaveBeenCalledWith("/tmp/notes.txt", "Edited"));
  await vi.waitFor(() => expect(controller.getAppState().document.saved).toBe("Edited"));
  expect(confirm()).toBe(true);
  expect(controller.getAppState().fileEvents.map(entry => entry.text)).toEqual(["Opened /tmp/notes.txt", "Saved /tmp/notes.txt"]);
});

test("native-test report launches install no app-wide registrations", async () => {
  spark.args = ["--spark-test-report", "/tmp/report.json"];
  const { controller } = await start();
  expect(spark.createMenu).not.toHaveBeenCalled();
  expect(spark.registerShortcut).not.toHaveBeenCalled();
  expect(spark.beforeQuit).not.toHaveBeenCalled();
  expect(controller.getAppState().locale).toBeUndefined();
});
