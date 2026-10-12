import { TurboModuleRegistry, type TurboModule } from "react-native";
/**
 * Private transport: JSON requests and results, validated on the JavaScript side (see index.ts).
 * `recordJavaScriptError` is synchronous, so a fatal error's report is written before React Native's handler runs.
 */
export interface Spec extends TurboModule {
  call(method: string, args: string): Promise<string>;
  recordJavaScriptError(error: string): string;
}
export default TurboModuleRegistry.get<Spec>("NativeDesktopDiagnostics");
