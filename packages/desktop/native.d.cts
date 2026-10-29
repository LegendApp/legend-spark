/** React Native discovery overrides produced by Spark. */
export type NativeConfiguration = {
  platforms?: Record<string, { npmPackageName?: string }>;
  dependencies?: Record<string, { root?: string; platforms?: Record<string, unknown> }>;
};
/** Spark-owned project: generate native discovery configuration. */
export function nativeConfig(root: string): NativeConfiguration;
/** Existing Expo project: compose with its React Native CLI configuration. */
export function withSparkNative<T extends object>(config: T, root: string): T & NativeConfiguration;
