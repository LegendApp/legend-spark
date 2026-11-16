import { ScrollView, Text } from "react-native";
import Config from "react-native-config";

// Test IDs: system-integration-config-passed, or -failed with the values read.
// examples/kitchen-sink/.env sets these; react-native-config compiles them in at build time.
const ID = "system-integration-config";

/** react-native-config: values from the app's .env, read through its native module. */
export function ConfigDemo() {
  const passed = Config.SPARK_CONFIG_FIXTURE === "kitchen-sink" && Config.SPARK_CONFIG_QUOTED === "spaced value";
  const values = JSON.stringify({ SPARK_CONFIG_FIXTURE: Config.SPARK_CONFIG_FIXTURE, SPARK_CONFIG_QUOTED: Config.SPARK_CONFIG_QUOTED });
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Reads two values from examples/kitchen-sink/.env, compiled into the app by the library's build phase.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${passed ? "passed" : "failed"}`}>{passed ? "passed" : `failed: ${values}`}</Text>
  </ScrollView>;
}
