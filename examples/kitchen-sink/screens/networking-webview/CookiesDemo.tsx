import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import CookieManager from "@react-native-cookies/cookies";

// Test IDs: networking-webview-cookies-passed, or -failed with the failing cases.
const ID = "networking-webview-cookies";
const URL = "https://cookies.spark.test";

async function roundTrip(useWebKit: boolean) {
  const name = `ks_${useWebKit ? "webkit" : "shared"}`;
  const failures: string[] = [];
  await CookieManager.set(URL, { name, value: "v1", path: "/", domain: "cookies.spark.test" }, useWebKit);
  const got = await CookieManager.get(URL, useWebKit);
  if (got[name]?.value !== "v1") failures.push(`${name} get (${JSON.stringify(got[name])})`);
  const all = await CookieManager.getAll(useWebKit);
  if (all[name]?.value !== "v1") failures.push(`${name} getAll`);
  await CookieManager.clearByName(URL, name, useWebKit);
  if ((await CookieManager.get(URL, useWebKit))[name]) failures.push(`${name} clearByName`);
  return failures;
}

/** @react-native-cookies/cookies: set, get, getAll and clearByName in the shared cookie store and WebKit's store. */
export function CookiesDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => {
    (async () => [...await roundTrip(false), ...await roundTrip(true)])()
      .then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`));
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Round-trips a cookie through NSHTTPCookieStorage and through WKWebsiteDataStore (useWebKit).</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
