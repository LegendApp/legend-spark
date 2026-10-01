import { NativeEventEmitter } from "react-native";
import { SparkError, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import Native from "./NativeSparkAudio";

/** Private audio transport. Install before native setup so readiness cannot lose events. */
export function onAudioEvent(name: "sparkAudioStatus" | "sparkMediaCommand", id: string, listener: (value: unknown) => void): Subscription {
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "The audio module is unavailable");
  return new NativeEventEmitter(Native).addListener(name, (event: unknown) => {
    if (event && typeof event === "object" && (event as { id?: unknown }).id === id) listener((event as { value?: unknown }).value);
  });
}
