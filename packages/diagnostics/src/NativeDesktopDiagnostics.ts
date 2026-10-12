import { TurboModuleRegistry, type TurboModule } from "react-native";
/** Private transport: JSON requests and results, validated on the JavaScript side (see index.ts). */
export interface Spec extends TurboModule { call(method: string, args: string): Promise<string>; }
export default TurboModuleRegistry.get<Spec>("NativeDesktopDiagnostics");
