import { Platform } from "react-native";
import Native from "./NativeDesktopLinks";
import { SparkError, invokeNative, parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
export async function callLinks<T>(method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Desktop linking requires a desktop host");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "Desktop linking module is unavailable");
  return parseNativeResult(await invokeNative(() => Native!.call(method, JSON.stringify(args))), validate);
}
export async function linksCommand(method: string, args: object = {}): Promise<void> { await callLinks(method, args, (value): value is null => value === null); }
