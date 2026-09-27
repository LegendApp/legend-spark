import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
export { openURL, canOpenURL, getInitialURL, addEventListener } from "expo-linking";
export type { URLListener } from "./api";
export async function openPath(_path: string): Promise<void> { throw new SparkError("E_UNSUPPORTED_PLATFORM", "Opening a native desktop path requires a desktop host"); }
