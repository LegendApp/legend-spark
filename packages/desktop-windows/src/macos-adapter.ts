import { Platform } from "react-native";
import { SparkError, invokeNative, parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
import { menuItems } from "@legendapp/spark-desktop-app/src/contracts/menu";
import Native from "./window-manager/NativeWindowManager";
import type { MacOSWindowOptions, WindowOpenOptions } from "./types";
export function macosNative() {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "This operation requires macOS");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "The macOS window module is unavailable");
  return Native;
}
export async function macosCommand(operation: () => Promise<string>): Promise<void> {
  const result = parseNativeResult(await invokeNative(operation), (value): value is { success: boolean; message?: string } => !!value && typeof value === "object" && typeof (value as any).success === "boolean");
  if (!result.success) throw new SparkError("E_NATIVE", result.message ?? "macOS window operation failed");
}
export function macosOptions(options: MacOSWindowOptions | undefined): Record<string, unknown> {
  if (!options) return {};
  const result: Record<string, unknown> = {}, style: Record<string, unknown> = {};
  if (options.representedUri !== undefined) result.representedURL = options.representedUri;
  if (options.restoreOnLaunch !== undefined) result.restoreOnLaunch = options.restoreOnLaunch;
  if (options.startupSplitView !== undefined) style.startupSplitView = options.startupSplitView;
  if (options.level !== undefined) {
    const names = { normal: "NORMAL", floating: "FLOATING", modalPanel: "MODAL_PANEL", mainMenu: "MAIN_MENU", status: "STATUS", screenSaver: "SCREEN_SAVER" };
    const constants = parseNativeResult(macosNative().getConstantsJson(), (value): value is Record<string, number> => !!value && typeof value === "object");
    const value = constants[`WINDOW_LEVEL_${names[options.level]}`];
    if (!Number.isFinite(value)) throw new SparkError("E_INVALID_DATA", "Missing native window level constant");
    result.level = value;
  }
  if (options.panelStyle !== undefined) style.panelStyle = options.panelStyle;
  const title = options.titleBar;
  if (title) {
    const fields = { contentLayout: "contentLayoutMode", transparent: "titlebarAppearsTransparent", titleVisibility: "titleVisibility", separator: "titlebarSeparatorStyle", material: "titlebarMaterial", blendingMode: "titlebarMaterialBlendingMode", materialState: "titlebarMaterialState", trafficLights: "trafficLights" } as const;
    for (const [key, target] of Object.entries(fields)) if (title[key as keyof typeof fields] !== undefined) style[target] = title[key as keyof typeof fields];
    if (title.controls) style.titlebarControls = title.controls.map(({ symbol, disabled, ...control }) => ({ ...control, type: "button", enabled: !disabled, systemImageName: symbol }));
  }
  if (options.toolbar) {
    if (options.toolbar.visible !== undefined) style.hasToolbar = options.toolbar.visible;
    if (options.toolbar.style !== undefined) style.toolbarStyle = options.toolbar.style;
    if (options.toolbar.items) style.toolbarItems = options.toolbar.items.map(item => {
      const { type, ...common } = item;
      if (type === "segmented") { const value = item as Extract<typeof item, { type: "segmented" }>; return { ...common, type, selectedValue: value.value, segments: value.segments.map(({ symbol, ...segment }) => ({ ...segment, systemImageName: symbol })) }; }
      if (type === "menu") { const { items, ...value } = item as Extract<typeof item, { type: "menu" }>; return { ...value, type: "menuButton", enabled: !value.disabled, systemImageName: value.symbol, menuItems: menuItems(items, { types: ["action", "checkbox", "separator", "slider"], icons: ["symbol"] }, "macos") }; }
      return { ...common, type, ...("disabled" in item ? { enabled: !item.disabled } : {}), ...("symbol" in item ? { systemImageName: item.symbol } : {}) };
    });
  }
  result.windowStyle = style;
  return result;
}
export async function createMacOSWindow(options: WindowOpenOptions): Promise<void> {
  await macosCommand(() => macosNative().openWindow(JSON.stringify({ ...macosOptions(options.macos), identifier: options.id, moduleName: options.component, initialProperties: options.props ?? {}, title: options.title, deferOrderFront: true, sparkOverlay: options.kind === "overlay" })));
}
export async function updateMacOSWindow(id: string, options: MacOSWindowOptions): Promise<void> {
  await macosCommand(() => macosNative().setWindowOptions(id, JSON.stringify(macosOptions(options))));
}
