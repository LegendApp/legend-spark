import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";
export interface Spec extends TurboModule {
  isAvailable(): boolean; call(method: string, args: string): Promise<string>; }
export default TurboModuleRegistry.getEnforcing<Spec>("NativeDesktopUpdates");
