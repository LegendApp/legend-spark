import type { UserConfig } from "@react-native-community/cli-types";
export type NativeConfiguration = Pick<Partial<UserConfig>, "platforms" | "dependencies">;
/** Spark-owned project: generate native discovery configuration. */
export function nativeConfig(root: string): NativeConfiguration;
/** Existing Expo project: compose with its React Native CLI configuration. */
export function withSparkNative<T extends Partial<UserConfig>>(config: T, root: string): T & NativeConfiguration;
