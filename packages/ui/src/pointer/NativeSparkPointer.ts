import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

/** Private transport for ./pointer. */
export interface Spec extends TurboModule {
  hideCursorUntilMoved(): Promise<void>;
  performHapticFeedback(pattern: string, performanceTime: string): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>("NativeSparkPointer");
