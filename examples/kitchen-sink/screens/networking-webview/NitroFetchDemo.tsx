import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { fetch, NitroFetch, prefetch } from "react-native-nitro-fetch";
import { exists, getDirectory } from "@legendapp/spark/files";

// Test IDs: networking-webview-nitro-fetch-passed, or -failed with the failing cases. Needs network access.
const ID = "networking-webview-nitro-fetch";
const URL = "https://registry.npmjs.org/react-native-nitro-fetch/1.9.0";

async function check() {
  const response = await fetch(URL, { headers: { Accept: "application/json" } });
  const body = await response.json() as { name?: string; version?: string };
  const missing = await fetch("https://registry.npmjs.org/react-native-nitro-fetch/0.0.0-missing");
  await prefetch(URL, { headers: { prefetchKey: "kitchen-sink-nitro-fetch" } });
  const prefetched = await fetch(URL, { headers: { prefetchKey: "kitchen-sink-nitro-fetch" } });
  return [
    // Without the native module the library silently falls back to the global fetch.
    typeof NitroFetch.createClient !== "function" && "native module",
    (!response.ok || response.status !== 200) && `status ${response.status}`,
    !response.headers.get("content-type")?.includes("json") && "headers",
    (body.name !== "react-native-nitro-fetch" || body.version !== "1.9.0") && "json",
    missing.status !== 404 && `missing status ${missing.status}`,
    (await prefetched.json() as { version?: string }).version !== "1.9.0" && "prefetch",
    !await exists(`${await getDirectory("cache")}/nitrofetch_urlcache`) && "cache folder",
  ].filter(Boolean);
}

/** react-native-nitro-fetch through its own fetch API; Spark only adds the macOS build. */
export function NitroFetchDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">{`Fetches ${URL} natively, checks status, headers and JSON, a 404, and a prefetched response.`}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
