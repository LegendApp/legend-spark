/** Load the panel module and desktop events only after the caller has established the platform. */
export function getPanelsNative(): typeof import("./NativeSparkPanels").default {
  return (require("./NativeSparkPanels") as typeof import("./NativeSparkPanels")).default;
}
export function onPanelEvent(...args: Parameters<typeof import("@legendapp/spark-desktop-app/src/events").onDesktopEvent>) {
  return (require("@legendapp/spark-desktop-app/src/events") as typeof import("@legendapp/spark-desktop-app/src/events")).onDesktopEvent(...args);
}
