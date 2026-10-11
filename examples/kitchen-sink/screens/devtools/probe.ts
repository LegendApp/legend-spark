import { getCurrentRuntime } from "@react-native-runtimes/core";

// Breakpoint target for React Native DevTools: Sources › screens/devtools/probe.ts. It runs in the shared runtime
// (Run probe) and in the ks-devtools worker runtime (Run probe in worker); each runtime keeps its own count.
let runs = 0;
export function probe(label: string) {
  runs += 1;
  const runtime = getCurrentRuntime().name;
  return { label, runs, runtime };
}
