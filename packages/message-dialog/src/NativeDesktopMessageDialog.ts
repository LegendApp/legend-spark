import { TurboModuleRegistry, type TurboModule } from "react-native";
export interface Spec extends TurboModule { call(method: string, args: string): Promise<string>; }
export default TurboModuleRegistry.get<Spec>("NativeDesktopMessageDialog");
