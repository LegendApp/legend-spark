import type { SparkConfig, WindowConfiguration } from "@legendapp/spark/config";
import type { WindowOpenOptions } from "@legendapp/spark/windows";
const window = { size: { width: 1000, height: 700 }, minSize: { width: 500, height: 300 }, restoreBounds: true } satisfies WindowConfiguration;
const runtime = { id: "editor", component: "Editor", ...window } satisfies WindowOpenOptions;
const config: SparkConfig = { name: "Editor", version: "1.0.0", projectId: "editor", platforms: ["macos"], window, macos: { bundleIdentifier: "com.example.editor" }, expo: { ios: { supportsTablet: true } } };
const overlay: SparkConfig = { extends: "expo", projectId: "editor", platforms: ["ios", "macos"], window };
// @ts-expect-error Configuration uses the runtime geometry vocabulary.
const flat: WindowConfiguration = { width: 800 };
// @ts-expect-error Target names are owned by Spark.
const target: SparkConfig = { ...config, platforms: ["linux"] };
// @ts-expect-error Backend-specific fields belong in expo, not the Spark root.
const backend: SparkConfig = { ...config, ios: { supportsTablet: true } };
void [runtime, overlay, flat, target, backend];
