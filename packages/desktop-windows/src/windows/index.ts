export { type WindowOptions, WindowStyleMask } from "@legendapp/spark-desktop-windows/src/window-manager";
export {
  createWindowsNavigator,
  type WindowsNavigator,
} from "./createWindowsNavigator";
export type { WindowConfigEntry, WindowsConfig } from "./types";
export { useWindowFocusEffect } from "./useWindowFocusEffect";
export {
  usePrimaryWindowLifecycle,
  type UsePrimaryWindowLifecycleOptions,
} from "./usePrimaryWindowLifecycle";
export {
  createBorderlessOverlayWindowStyle,
  createDocumentWindowStyle,
  createUnifiedToolbarWindowStyle,
} from "./windowStyles";
export { useWindowId, WindowProvider, withWindowProvider } from "./WindowProvider";
