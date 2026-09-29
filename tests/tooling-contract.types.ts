import { getDefaultConfig, metroConfig, withSparkMetro, withDesktop } from "@legendapp/spark/metro";
import { nativeConfig, withSparkNative } from "@legendapp/spark/native";
if (false) {
  const config = getDefaultConfig("/project");
  withSparkMetro(config);
  withSparkMetro(Promise.resolve(config));
  withDesktop(metroConfig("/project"), { watch: false });
  withSparkNative({ ...nativeConfig("/project"), assets: ["./fonts"] }, "/project");
  // @ts-expect-error Spark-owned options are deliberate, not an arbitrary forwarding bag.
  withDesktop(config, { roots: ["src"] });
}
