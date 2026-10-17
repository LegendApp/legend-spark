import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";
export interface Spec extends TurboModule {
  /** Resolves (macOS) with JSON of each published item's shown title by owner token and item ID; Windows resolves null. */
  publish(menusJson: string): Promise<string | null>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}
export default TurboModuleRegistry.get<Spec>("NativeMenu");
