import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
  scanFiles(id: string, pathsJson: string, optionsJson: string): Promise<string>;
  cancelScan(id: string): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>("NativeFileScanner");
