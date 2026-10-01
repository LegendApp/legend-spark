import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
  startMonitoringKeyboard(): Promise<boolean>;
  stopMonitoringKeyboard(): Promise<boolean>;
  setConsumption(ownerId: string, rulesJson: string, capture: boolean): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>("NativeKeyboardManager");
