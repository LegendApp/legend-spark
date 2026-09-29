import type { ExpoOverrides } from "./config.cjs";
/** Compose Spark's desktop overlay without replacing Expo's configuration model. */
export function withSparkExpo<Context>(original: ExpoOverrides | ((context: Context) => ExpoOverrides), root: string): (context: Context) => ExpoOverrides;
