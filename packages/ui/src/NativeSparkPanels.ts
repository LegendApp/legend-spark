import { TurboModuleRegistry, type TurboModule } from "react-native";
/** Private transport for panels.ts: JSON in, JSON out; changes arrive as desktop events. */
export interface Spec extends TurboModule { call(method: string, args: string): Promise<string>; }
export default TurboModuleRegistry.get<Spec>("NativeSparkPanels");
