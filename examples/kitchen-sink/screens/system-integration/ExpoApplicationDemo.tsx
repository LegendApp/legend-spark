import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as Application from "expo-application";

// Test IDs: system-integration-expo-application-passed, or -failed with the failing cases.
const ID = "system-integration-expo-application";

async function check() {
  const installed = await Application.getInstallationTimeAsync();
  const releaseType = await Application.getIosApplicationReleaseTypeAsync();
  return {
    summary: `${Application.applicationName} ${Application.applicationId} ${Application.nativeApplicationVersion} (${Application.nativeBuildVersion}), installed ${installed.toISOString()}`,
    failures: [
      Application.applicationId !== "so.legend.spark.examples.kitchensink" && `id (${Application.applicationId})`,
      !Application.nativeApplicationVersion && "version",
      !(installed.getTime() > Date.UTC(2020, 0) && installed.getTime() <= Date.now()) && "installation time",
      await Application.getIosIdForVendorAsync() !== null && "vendor id should be null",
      releaseType !== Application.ApplicationReleaseType.UNKNOWN && `release type (${releaseType})`,
    ].filter(Boolean),
  };
}

/** expo-application through its own API; Spark's patch adds the macOS build. */
export function ExpoApplicationDemo() {
  const [result, setResult] = useState<{ summary?: string; failures: (string | false)[] }>();
  useEffect(() => { check().then(setResult, error => setResult({ failures: [String(error)] })); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">{result?.summary ?? "…"}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result.failures.length ? "failed" : "passed"}` : undefined}>{result ? (result.failures.length ? `failed: ${result.failures.join(", ")}` : "passed") : "running"}</Text>
  </ScrollView>;
}
