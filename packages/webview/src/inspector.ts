import { Platform, TurboModuleRegistry } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";

/** Safari's Web Inspector attaches to WebViews on macOS (WKWebView `isInspectable`, macOS 13.3 and later; Spark needs 14). */
export function getWebViewInspectorAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return TurboModuleRegistry.get("RNCWebViewModule") ? { available: true } : { available: false, reason: "missing-module" };
}

/**
 * The backend's `webviewDebuggingEnabled` for a WebView's `inspectable` prop: the prop, or `__DEV__` when it is unset.
 * Where the Web Inspector is unavailable an unset prop leaves the backend's default and a set one throws.
 */
export function inspectable(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "WebView inspectable must be a boolean");
  const availability = getWebViewInspectorAvailability();
  if (availability.available) return value ?? __DEV__;
  if (value === undefined) return undefined;
  throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "The WebView inspector is unavailable: " + availability.reason);
}
