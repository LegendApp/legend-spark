import { Platform } from "react-native";
import { callBinary } from "@legendapp/spark-desktop-app/src/contracts/native-buffer";
import { SparkError, invokeNative, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import Native from "./NativeDesktopFileSystem";
export function getFileSystemAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
export function native() {
  const availability = getFileSystemAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "File IO requires a desktop host with NativeDesktopFileSystem installed");
  return Native!;
}
/**
 * Desktop targets implementing each optional file capability. Module presence is checked separately.
 * Windows omissions: bookmarks, Full Disk Access and coordination have no Windows counterpart; alternate
 * data streams are not extended attributes; previews need a hosted IPreviewHandler (LegendApp/legend-spark#223).
 */
const support = {
  bookmarks: ["macos"], fullDiskAccess: ["macos"], coordination: ["macos"], openWith: ["macos", "windows"],
  fileIcons: ["macos", "windows"], thumbnails: ["macos", "windows"], quickLook: ["macos"], extendedAttributes: ["macos"],
  quarantine: ["macos", "windows"], diskSpace: ["macos", "windows"],
} as const satisfies Record<string, readonly ("macos" | "windows")[]>;
export type FileFeature = keyof typeof support;
export function featureAvailability(feature: FileFeature): Availability {
  const base = getFileSystemAvailability();
  if (!base.available) return base;
  return (support[feature] as readonly string[]).includes(Platform.OS) ? { available: true } : { available: false, reason: "unsupported-platform" };
}
/** Throws a typed error before native dispatch when the feature is unavailable. */
export function requireFeature(feature: FileFeature, label: string) {
  const availability = featureAvailability(feature);
  if (availability.available) return;
  if (availability.reason === "unsupported-platform") throw new SparkError("E_UNSUPPORTED_PLATFORM", `${label} is not supported on ${Platform.OS}`);
  native();
}
export const absolute = (path: string) => nativePath(path, Platform.OS);
export async function call<T = void>(method: string, args: object, valid: (value: unknown) => boolean): Promise<T> {
  const { bytes, ...metadata } = args as { bytes?: Uint8Array };
  const value = await invokeNative(() => callBinary(native(), "__sparkFileSystemBinary", method, metadata, bytes));
  if (!valid(value)) throw new SparkError("E_INVALID_DATA", "Invalid native file response");
  return value as T;
}
/** Rejects unknown or extra option keys so a misspelled option can never silently no-op. */
export function checkedOptions<T extends object>(options: T, allowed: readonly string[], label: string): T {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", `Expected ${label} options`);
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown ${label} option: ${key}`);
  return options;
}
export function booleanOption(value: unknown, name: string, defaultValue: boolean): boolean {
  if (value !== undefined && typeof value !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", `${name} must be a boolean`);
  return (value as boolean | undefined) ?? defaultValue;
}
