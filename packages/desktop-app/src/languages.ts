import { callAppNative } from "./transport";
import { getAppAvailability } from "./api";
import { SparkError } from "./contracts";

/** The languages of the app's native strings: menus, dialogs and the panels AppKit provides. */
export interface AppLanguages {
  /** Languages the app lists (`localizations` in desktop.config.json), such as "en", "ar" or "pt-BR". */
  supported: readonly string[];
  /**
   * The language this launch chose: the first of the user's languages for this app that `supported`
   * lists, else the app's development language. AppKit's and Spark's native strings use it.
   */
  current: string;
  /** The language chosen for this app alone (`setAppLanguage`, or System Settings), or null when it follows the system. */
  override: string | null;
  /** Languages Spark's own native strings are translated into. In others they are English; AppKit's still follow `current`. */
  framework: readonly string[];
}

const LANGUAGE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)*$/;

function requireAvailable() {
  const availability = getAppAvailability("languages");
  if (!availability.available) throw new SparkError(availability.reason === "missing-module" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM", "App languages require macOS with NativeDesktopApp installed");
}
const languages = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0);
function appLanguages(value: unknown): value is AppLanguages {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return languages(result.supported) && languages(result.framework) && typeof result.current === "string" && result.current.length > 0 && (result.override === null || typeof result.override === "string");
}

export async function getAppLanguages(): Promise<AppLanguages> {
  requireAvailable();
  const { supported, current, override, framework } = await callAppNative("languages", appLanguages);
  return { supported: [...supported], current, override, framework: [...framework] };
}

/**
 * Chooses the app's language for later launches, as System Settings › General › Language & Region ›
 * Applications does; null follows the system's languages again. It must be one of
 * `getAppLanguages().supported`. The running app keeps its language: call `relaunch()` to apply it now.
 */
export async function setAppLanguage(language: string | null): Promise<void> {
  if (language !== null && (typeof language !== "string" || !LANGUAGE.test(language))) throw new SparkError("E_INVALID_ARGUMENT", "Expected a language identifier such as ar or pt-BR, or null");
  requireAvailable();
  await callAppNative("setLanguage", (value): value is null => value === null, { language });
}
