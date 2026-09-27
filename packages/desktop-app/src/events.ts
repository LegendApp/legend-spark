import { NativeEventEmitter, TurboModuleRegistry } from "react-native";
import type { Spec } from "./NativeDesktopApp";
import { SparkError, type Subscription } from "./contracts";
/** Internal bridge transport. Feature modules validate their own event payloads. */
export type DesktopEvent = { type: string; id?: string; url?: string; windowId?: string; [key: string]: unknown };
export function onDesktopEvent(listener: (event: DesktopEvent) => void): Subscription {
  const native = TurboModuleRegistry.get<Spec>("NativeDesktopApp");
  if (!native) throw new SparkError("E_MODULE_UNAVAILABLE", "Desktop event module is unavailable");
  const subscription = new NativeEventEmitter(native).addListener("desktop", (event: unknown) => {
    if (event && typeof event === "object" && typeof (event as DesktopEvent).type === "string") listener(event as DesktopEvent);
  });
  return subscription;
}
