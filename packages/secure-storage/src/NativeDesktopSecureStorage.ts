import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";
export interface Spec extends TurboModule {
  callSync(method: string, args: string): string;
  call(method: string, args: string): Promise<string>;
}
export default TurboModuleRegistry.getEnforcing<Spec>("NativeDesktopSecureStorage");
