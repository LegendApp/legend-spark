import { useEffect, useState } from "react";
import { ScrollView, Text, TurboModuleRegistry } from "react-native";
import performance from "react-native-performance";

// Test IDs: devtools-performance-passed, or -failed with the failing cases.
// The native startup marks (nativeLaunchStart, runJsBundleEnd…) come from the legacy bridge's performance logger,
// which Spark's bridgeless host doesn't create, so the screen lists what arrived without requiring them.
const ID = "devtools-performance";

async function check() {
  performance.mark("ks-start");
  await new Promise(resolve => setTimeout(resolve, 20));
  performance.mark("ks-end", { detail: { screen: "performance" } });
  const measure = performance.measure("ks-span", "ks-start", "ks-end");
  const native = performance.getEntriesByType("react-native-mark").map(entry => entry.name);
  return {
    info: `measure ${measure.duration.toFixed(1)} ms; native marks: ${native.join(", ") || "none"}`,
    failures: [
      !TurboModuleRegistry.get("RNPerformanceManager") && "native module not linked",
      !(measure.duration >= 15) && `measure duration (${measure.duration})`,
      (performance.getEntriesByName("ks-end")[0] as { detail?: { screen?: string } } | undefined)?.detail?.screen !== "performance" && "mark detail",
      performance.getEntriesByName("ks-span", "measure").length !== 1 && "measure entry",
    ].filter(Boolean),
  };
}

/** react-native-performance: User Timing marks and measures through its native module. */
export function PerformanceDemo() {
  const [result, setResult] = useState<string>();
  const [info, setInfo] = useState("");
  useEffect(() => { check().then(({ info, failures }) => { setInfo(info); setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"); }, error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text selectable className="font-mono text-xs text-muted">{info}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
