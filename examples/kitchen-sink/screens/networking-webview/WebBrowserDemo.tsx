import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as WebBrowser from "expo-web-browser";

// Test ID: networking-webview-expo-web-browser-<result> once openBrowserAsync (an in-app web window on
// macOS) resolves after dismissBrowser closes it; the expected result is dismiss.
const ID = "networking-webview-expo-web-browser";

async function check() {
  const opened = WebBrowser.openBrowserAsync("https://example.com");
  await new Promise(resolve => setTimeout(resolve, 1500));
  WebBrowser.dismissBrowser();
  return (await opened).type;
}

/** expo-web-browser through its own API; it supports macOS upstream with a WKWebView window. */
export function WebBrowserDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(setResult, error => setResult(`failed ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Opens example.com in the browser window, then closes it with dismissBrowser.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
