import { TurboModuleRegistry, type TurboModule } from "react-native";
/** Private transport. `log` returns nothing, so an entry never waits for native; `call` carries JSON requests and results, validated in index.ts. */
export interface Spec extends TurboModule {
  log(time: number, level: string, category: string, message: string, fields: string, publicMessage: boolean): void;
  call(method: string, args: string): Promise<string>;
}
export default TurboModuleRegistry.get<Spec>("NativeDesktopLogging");
