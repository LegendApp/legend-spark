import type { NavigatorWindowOptions } from "@legendapp/spark-desktop-windows/src/windows/types";
export type CreateSettingsWindowOptionsInput = NavigatorWindowOptions;
/** SettingsWindow presents the hidden window when its native layout is ready.
 * Set `macos.titleBar.titleVisibility` to `"visible"` to show the native title.
 */
export function createSettingsWindowOptions(options: CreateSettingsWindowOptionsInput = {}): NavigatorWindowOptions {
  const { titleVisibility = "hidden", ...titleBar } = options.macos?.titleBar ?? {};
  return {
    title: "Settings", transparent: true, size: { width: 820, height: 640 }, minSize: { width: 720, height: 500 }, titleBarStyle: "overlay",
    ...options, show: false,
    macos: { ...options.macos, titleBar: { transparent: true, separator: "none", ...titleBar, titleVisibility }, toolbar: { visible: true, style: "unified", ...options.macos?.toolbar } },
  };
}
