import { useEffect, useState } from "react";
import { NativeModules, ScrollView, Text } from "react-native";
import { setupURLPolyfill } from "react-native-url-polyfill";
import EventSource from "react-native-sse";
import PostHog from "posthog-react-native";

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

// The e2e bundle server serves /sse; under Metro there is no stream to read.
function sse() {
  const origin = String(NativeModules.SourceCode?.getConstants?.().scriptURL ?? "").match(/^https?:\/\/[^/]+/)?.[0];
  if (!origin) return Promise.reject(new Error("no bundle server origin"));
  return new Promise<void>((resolve, reject) => {
    const received: string[] = [];
    const source = new EventSource<"done">(`${origin}/sse`, { pollingInterval: 0 });
    const timer = setTimeout(() => { source.close(); reject(new Error(`timed out after ${received.join(",")}`)); }, 5000);
    source.addEventListener("message", event => { received.push(`${event.lastEventId}:${event.data}`); });
    source.addEventListener("done", event => {
      clearTimeout(timer); source.close();
      const expected = ['1:{"sent":1}', '2:{"sent":2}'];
      if (JSON.stringify(received) === JSON.stringify(expected) && event.data === '{"sent":3}') resolve();
      else reject(new Error(`received ${received.join(",")} then ${event.data}`));
    });
    source.addEventListener("error", event => { clearTimeout(timer); source.close(); reject(new Error("message" in event ? String(event.message) : event.type)); });
  });
}

async function posthog() {
  const requests: { url: string; body: string }[] = [];
  class RecordingPostHog extends PostHog {
    fetch(url: string, options: { body?: unknown }) {
      requests.push({ url, body: String(options.body ?? "") });
      return Promise.resolve({ status: 200, text: async () => "{}", json: async () => ({}) });
    }
  }
  const client = new RecordingPostHog("phc_kitchen_sink", { host: "https://posthog.invalid", persistence: "memory", flushAt: 1, captureAppLifecycleEvents: false, preloadFeatureFlags: false, disableRemoteConfig: true, enableSessionReplay: false } as never);
  try {
    client.identify("kitchen-sink-user");
    client.capture("kitchen_sink_check", { answer: 42 });
    await client.flush();
    const batch = requests.find(request => request.body.includes("kitchen_sink_check"));
    if (!batch) throw new Error(`no captured batch in ${requests.map(request => request.url).join(", ") || "no requests"}`);
    if (!batch.body.includes('"answer":42') || !batch.body.includes("kitchen-sink-user")) throw new Error("batch lacks the event properties or distinct id");
  } finally { await client.shutdown(); }
}

const checks = { "url-polyfill": urlPolyfill, sse, posthog };

/** Non-visual JavaScript libraries exercised on the app's own runtime: Hermes, React Native's XHR and Blob module. */
export function JSLibraryChecks() {
  const [results, setResults] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const [name, run] of Object.entries(checks))
      run().then(() => setResults(previous => ({ ...previous, [name]: "passed" })), error => setResults(previous => ({ ...previous, [name]: `failed: ${String(error)}` })));
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">react-native-url-polyfill parses URLs and blob URLs; react-native-sse reads a server-sent event stream from the e2e bundle server; posthog-react-native captures and flushes an event through a recording fetch.</Text>
    {Object.keys(checks).map(name => <Text key={name} selectable className="font-mono text-xs text-foreground" testID={results[name] ? `${ID}-${name}-${results[name] === "passed" ? "passed" : "failed"}` : undefined}>{`${name}: ${results[name] ?? "running"}`}</Text>)}
  </ScrollView>;
}
