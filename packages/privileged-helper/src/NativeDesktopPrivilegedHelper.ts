import { TurboModuleRegistry, type TurboModule } from "react-native";
/** Private transport: JSON requests and results, validated in index.ts. */
export interface Spec extends TurboModule {
  call(method: string, args: string): Promise<string>;
  /** Synchronous: "available" or "unsigned". */
  availability(): string;
}
export default TurboModuleRegistry.get<Spec>("NativeDesktopPrivilegedHelper");
