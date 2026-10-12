import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
export { openURL, canOpenURL, getInitialURL, addEventListener } from "expo-linking";
export type { URLListener } from "./api";
export async function openPath(_path: string): Promise<void> { throw new SparkError("E_UNSUPPORTED_PLATFORM", "Opening a native desktop path requires a desktop host"); }
export function getDefaultURLHandlerAvailability() { return { available: false, reason: "unsupported-platform" } as const; }
export async function isDefaultURLHandler(_scheme: string): Promise<boolean> { throw new SparkError("E_UNSUPPORTED_PLATFORM", "Default URL handlers require macOS"); }
export async function setDefaultURLHandler(_scheme: string): Promise<void> { throw new SparkError("E_UNSUPPORTED_PLATFORM", "Default URL handlers require macOS"); }
