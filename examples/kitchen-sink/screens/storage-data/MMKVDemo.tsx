import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { createMMKV } from "react-native-mmkv";
import { exists, getDirectory } from "@legendapp/spark/files";

// Test IDs: storage-data-mmkv-passed or -failed shows the round-trip result; storage-data-mmkv-launch-<n>
// counts launches persisted in MMKV, so clearState resets it only if MMKV lives in the app's data folder.
const ID = "storage-data-mmkv";

async function check() {
  const storage = createMMKV({ id: "kitchen-sink-mmkv" });
  const launches = (storage.getNumber("launches") ?? 0) + 1;
  storage.set("launches", launches);
  const scratch = createMMKV({ id: "kitchen-sink-mmkv-scratch" });
  scratch.clearAll();
  const changed: string[] = [];
  const listener = scratch.addOnValueChangedListener(key => changed.push(key));
  try {
    scratch.set("text", "héllo 👋");
    scratch.set("number", 42.5);
    scratch.set("flag", true);
    const flag = scratch.getBoolean("flag");
    scratch.set("bytes", new Uint8Array([0, 127, 255]).buffer);
    const removed = scratch.remove("flag") && !scratch.contains("flag");
    // Nitro delivers native callbacks to JS asynchronously.
    for (let waited = 0; changed.length < 5 && waited < 2000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
    const bytes = new Uint8Array(scratch.getBuffer("bytes") ?? new ArrayBuffer(0));
    const failures = [
      scratch.getString("text") !== "héllo 👋" && "string",
      scratch.getNumber("number") !== 42.5 && "number",
      flag !== true && "boolean",
      (bytes.length !== 3 || bytes[2] !== 255) && "buffer",
      scratch.getAllKeys().sort().join() !== "bytes,number,text" && "keys",
      !removed && "remove",
      changed.join() !== "text,number,flag,bytes,flag" && `listener (${changed.join()})`,
      !await exists(`${await getDirectory("data")}/mmkv/kitchen-sink-mmkv`) && "data file",
    ].filter(Boolean);
    return { launches, result: failures.length ? `failed: ${failures.join(", ")}` : "passed" };
  } finally {
    listener.remove();
    scratch.clearAll();
  }
}

/** react-native-mmkv through its own API; Spark only patches where the macOS build stores files. */
export function MMKVDemo() {
  const [state, setState] = useState<{ launches?: number; result: string }>({ result: "running" });
  useEffect(() => { check().then(setState, error => setState({ result: `failed: ${String(error)}` })); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Values, buffers and listeners round-trip through MMKV. The launch count persists between launches.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={state.result === "running" ? undefined : `${ID}-${state.result === "passed" ? "passed" : "failed"}`}>{state.result}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={state.launches ? `${ID}-launch-${state.launches}` : undefined}>{`launches: ${state.launches ?? "…"}`}</Text>
  </ScrollView>;
}
