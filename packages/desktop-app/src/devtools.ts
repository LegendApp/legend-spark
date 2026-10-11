import { Platform, TurboModuleRegistry } from "react-native";
import { SparkError, type Availability } from "./contracts";
import { callAppNative } from "./transport";

/** A JavaScript runtime's debug target: the app's shared runtime, or an isolated runtime by name. */
export type DevToolsRuntime = "shared" | { isolated: string };
export interface OpenDevToolsOptions {
  /** Default: the runtime that calls `openDevTools`. */
  runtime?: DevToolsRuntime;
}
/** `development-only`: DevTools needs a development build running JavaScript from the development server. */
export type DevToolsAvailability = Availability | { available: false; reason: "development-only" };

/** React Native DevTools exists on macOS in development builds. Release builds contain none of it. */
export function getDevToolsAvailability(): DevToolsAvailability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  if (!__DEV__) return { available: false, reason: "development-only" };
  return TurboModuleRegistry.get("NativeDesktopApp") ? { available: true } : { available: false, reason: "missing-module" };
}

const errorCodes = { "unsupported-platform": "E_UNSUPPORTED_PLATFORM", "missing-module": "E_MODULE_UNAVAILABLE", "host-restriction": "E_UNAVAILABLE", "development-only": "E_UNAVAILABLE" } as const;
function runtimeName(options: OpenDevToolsOptions): string | undefined {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected DevTools options");
  for (const key of Object.keys(options)) if (key !== "runtime") throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown DevTools option: ${key}`);
  const runtime: unknown = options.runtime;
  // The calling runtime: @react-native-runtimes names each isolated runtime in this global.
  if (runtime === undefined) return (globalThis as { __THREADED_RUNTIME_ENV__?: { runtimeName?: string } }).__THREADED_RUNTIME_ENV__?.runtimeName;
  if (runtime === "shared") return undefined;
  if (runtime && typeof runtime === "object" && !Array.isArray(runtime)) {
    for (const key of Object.keys(runtime)) if (key !== "isolated") throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown DevTools runtime option: ${key}`);
    const { isolated } = runtime as { isolated?: unknown };
    if (typeof isolated === "string" && isolated.length > 0) return isolated;
  }
  throw new SparkError("E_INVALID_ARGUMENT", 'Expected runtime "shared" or { isolated: <runtime name> }');
}

/**
 * Opens React Native DevTools (breakpoints, console, sources, profiling) for one JavaScript runtime. Each runtime is
 * a separate debug target at the development server. Resolves once the server has the request; it opens the
 * DevTools window. Rejects `E_UNAVAILABLE` without a development server and `E_NOT_FOUND` when the runtime has no
 * target (it is not running). Development builds press ⌥⌘I for the shared runtime.
 */
export async function openDevTools(options: OpenDevToolsOptions = {}): Promise<void> {
  const runtime = runtimeName(options);
  const availability = getDevToolsAvailability();
  if (!availability.available) throw new SparkError(errorCodes[availability.reason], "React Native DevTools is unavailable: " + availability.reason);
  await callAppNative("openDevTools", (value): value is null => value === null, runtime === undefined ? {} : { runtime });
}
