import type { NavigatorWindowOptions } from "@legendapp/spark-desktop-windows/src/windows/types";
export type CreateSettingsWindowOptionsInput = NavigatorWindowOptions;
/** SettingsWindow presents the hidden window when its native layout is ready. */
export function createSettingsWindowOptions(options: CreateSettingsWindowOptionsInput = {}): NavigatorWindowOptions {
  return {
    title: "Settings", transparent: true, size: { width: 820, height: 640 }, minSize: { width: 720, height: 500 }, titleBarStyle: "overlay",
    ...options, show: false,
    macos: { ...options.macos, titleBar: { transparent: true, separator: "none", titleVisibility: "visible", ...options.macos?.titleBar }, toolbar: { visible: true, style: "unified", ...options.macos?.toolbar } },
  };
}
