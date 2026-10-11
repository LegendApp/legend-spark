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
}

export default TurboModuleRegistry.get<Spec>("NativeSparkMotion");
