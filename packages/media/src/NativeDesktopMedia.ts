import { TurboModuleRegistry, type TurboModule } from "react-native";
/** Private transport for video and speech: JSON requests and results, validated in video.tsx and speech.ts. */
export interface Spec extends TurboModule {
  call(method: string, args: string): Promise<string>;
}
export default TurboModuleRegistry.get<Spec>("NativeDesktopMedia");
