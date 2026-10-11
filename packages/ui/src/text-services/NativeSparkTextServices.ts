import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

/** Private transport for ./ui/text-services. `tag` is the React tag of a mounted view that contains a text view. */
export interface Spec extends TurboModule {
  isWritingToolsAvailable(): boolean;
  findText(tag: number, query: string, caseSensitive: boolean, wrap: boolean, backwards: boolean): Promise<string>;
  showFindBar(tag: number): Promise<void>;
  lookUp(tag: number): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>("NativeSparkTextServices");
