import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
  open(optionsJson: string): Promise<string>;
  save(optionsJson: string): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>("NativeFileDialog");
