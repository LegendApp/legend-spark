import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as Device from "expo-device";

// Test IDs: system-integration-expo-device-passed, or -failed with the failing values.
const ID = "system-integration-expo-device";

async function check() {
  const uptime = await Device.getUptimeAsync();
  const values = { modelId: Device.modelId, osName: Device.osName, osVersion: Device.osVersion, osBuildId: Device.osBuildId, deviceName: Device.deviceName, deviceType: Device.deviceType, totalMemory: Device.totalMemory, cpu: Device.supportedCpuArchitectures, uptime };
  return {
    values,
    failures: [
      !/^Mac/.test(Device.modelId ?? "") && "modelId",
      Device.osName !== "macOS" && "osName",
      !/^\d+\.\d+\.\d+$/.test(Device.osVersion ?? "") && "osVersion",
      !Device.osBuildId && "osBuildId",
      !Device.deviceName && "deviceName",
      Device.deviceType !== Device.DeviceType.DESKTOP && "deviceType",
      !((Device.totalMemory ?? 0) > 1e9) && "totalMemory",
      !Device.supportedCpuArchitectures?.length && "cpu",
      !(uptime > 0) && "uptime",
    ].filter(Boolean),
  };
}

/** expo-device through its own API; Spark's patch adds the macOS answers. */
export function ExpoDeviceDemo() {
  const [result, setResult] = useState<{ values?: object; failures: (string | false)[] }>();
  useEffect(() => { check().then(setResult, error => setResult({ failures: [String(error)] })); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text selectable className="font-mono text-xs text-muted">{result?.values ? JSON.stringify(result.values, null, 2) : "…"}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result.failures.length ? "failed" : "passed"}` : undefined}>{result ? (result.failures.length ? `failed: ${result.failures.join(", ")}` : "passed") : "running"}</Text>
  </ScrollView>;
}
