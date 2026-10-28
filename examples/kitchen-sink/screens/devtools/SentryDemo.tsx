import { useEffect, useState } from "react";
import { ScrollView, Text, TurboModuleRegistry } from "react-native";
import * as Sentry from "@sentry/react-native";
import type { ErrorEvent } from "@sentry/react-native";

// Test IDs: devtools-sentry-passed, or -failed with the failing cases. Nothing is sent: beforeSend keeps
// the event and drops it, and the client closes afterwards.
const ID = "devtools-sentry";

async function check() {
  let captured: ErrorEvent | undefined;
  Sentry.init({ dsn: "https://public@sentry.invalid/1", beforeSend: event => { captured = event; return null; } });
  Sentry.captureException(new Error("Kitchen Sink test error"));
  for (let waited = 0; !captured && waited < 3000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
  await Sentry.close();
  const native = TurboModuleRegistry.get("RNSentry") != null;
  return {
    info: `native module ${native ? "linked" : "missing"}; os ${captured?.contexts?.os?.name ?? "?"} ${captured?.contexts?.os?.version ?? ""}; device ${captured?.contexts?.device?.model ?? "?"}`,
    failures: [
      captured?.exception?.values?.[0]?.value !== "Kitchen Sink test error" && "captured exception",
      !captured?.exception?.values?.[0]?.stacktrace?.frames?.length && "stack trace",
      !native && "native module",
      captured?.contexts?.os?.name !== "macOS" && `native os context (${captured?.contexts?.os?.name})`,
    ].filter(Boolean),
  };
}

/** @sentry/react-native through its own API; sentry-cocoa supports macOS. */
export function SentryDemo() {
  const [result, setResult] = useState<string>();
  const [info, setInfo] = useState("");
  useEffect(() => { check().then(({ info, failures }) => { setInfo(info); setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"); }, error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Initializes Sentry, captures an error and inspects the event, including the native macOS context.</Text>
    <Text selectable className="font-mono text-xs text-muted">{info}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
