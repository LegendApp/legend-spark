import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

/** Private transport. Requests and results are JSON validated on both sides; see motion.ts. */
export interface Spec extends TurboModule {
  run(planJson: string): Promise<string>;
  stopAnimation(identifier: string): Promise<void>;
  set(requestJson: string): Promise<void>;
  stop(requestJson: string): Promise<void>;
  getState(tag: number): Promise<string>;
  link(requestJson: string): Promise<void>;
  unlink(identifier: string): Promise<void>;
  recordFrames(requestJson: string): Promise<string>;
  /** `tag` 0 reads the main display without a window. */
  environment(tag: number): Promise<string>;
  /** Resolves `{ played }`: the effect, its Reduce Motion alternate (`pulse`, `fade`) or `none`. */
  playSymbolEffect(requestJson: string): Promise<string>;
  removeSymbolEffect(requestJson: string): Promise<void>;
  /** Whether an SF Symbol with this name exists on this macOS. */
  hasSymbol(name: string): boolean;
  /** Whether this app's SDK and this macOS have a symbol effect, or `replace`. */
  supportsSymbolEffect(name: string): boolean;
}

export default TurboModuleRegistry.get<Spec>("NativeSparkMotion");
