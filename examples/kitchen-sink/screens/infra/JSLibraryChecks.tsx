import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { setupURLPolyfill } from "react-native-url-polyfill";

// Test IDs: infra-js-libraries-<url-polyfill|sse|posthog>-passed, or -failed with the reason.
const ID = "infra-js-libraries";

async function urlPolyfill() {
  setupURLPolyfill();
  const url = new URL("https://user:pw@example.com:8080/a/../b c?x=1&y=two#frag");
  url.searchParams.append("z", "é");
  const blob = URL.createObjectURL({ data: { blobId: "abc", offset: 0 }, size: 3 } as unknown as Blob);
  const failures = [
    url.href !== "https://user:pw@example.com:8080/b%20c?x=1&y=two&z=%C3%A9#frag" && `href ${url.href}`,
    url.searchParams.get("y") !== "two" && "searchParams",
    !blob.endsWith("abc?offset=0&size=3") && `blob ${blob}`,
  ].filter(Boolean);
  if (failures.length) throw new Error(failures.join(", "));
}

const checks = { "url-polyfill": urlPolyfill };

/** Non-visual JavaScript libraries exercised on the app's own runtime: Hermes, React Native's XHR and Blob module. */
export function JSLibraryChecks() {
  const [results, setResults] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const [name, run] of Object.entries(checks))
      run().then(() => setResults(previous => ({ ...previous, [name]: "passed" })), error => setResults(previous => ({ ...previous, [name]: `failed: ${String(error)}` })));
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">react-native-url-polyfill parses URLs and blob URLs.</Text>
    {Object.keys(checks).map(name => <Text key={name} selectable className="font-mono text-xs text-foreground" testID={results[name] ? `${ID}-${name}-${results[name] === "passed" ? "passed" : "failed"}` : undefined}>{`${name}: ${results[name] ?? "running"}`}</Text>)}
  </ScrollView>;
}
