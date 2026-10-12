import { TurboModuleRegistry, type TurboModule } from "react-native";
/** Private transport: JSON requests and results, validated in shared.ts. */
export interface Spec extends TurboModule {
  call(method: string, args: string): Promise<string>;
  /** Synchronous: "available" or "missing-entitlement" for { feature, relyingPartyId? }. */
  availability(args: string): string;
}
export default TurboModuleRegistry.get<Spec>("NativeDesktopAuthentication");
