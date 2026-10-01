import { TurboModuleRegistry, type TurboModule } from "react-native";
export interface Spec extends TurboModule {
  call(method: string, args: string): Promise<string>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}
export default TurboModuleRegistry.get<Spec>("NativeSparkAudio");
