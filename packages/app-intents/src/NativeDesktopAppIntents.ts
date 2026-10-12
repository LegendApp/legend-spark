import { TurboModuleRegistry, type TurboModule } from "react-native";
/** Private transport: JSON requests and results, validated in index.ts. */
export interface Spec extends TurboModule {
  /** Whether the system can run this app's intents: the build compiled them (or the test driver simulates them). */
  isAvailable(): boolean;
  call(method: string, args: string): Promise<string>;
}
export default TurboModuleRegistry.get<Spec>("NativeDesktopAppIntents");
