import { useState } from "react";
import { getWebViewInspectorAvailability, type WebViewSource } from "@legendapp/spark/webview";

/** A small page in the app's language and appearance, for Safari's Web Inspector to attach to. */
export function inspectedPage(text: string, rtl: boolean): WebViewSource {
  return { html: `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta name="color-scheme" content="light dark"><style>body{font:13px -apple-system,system-ui;margin:12px}</style></head><body><p id="inspected">${text}</p><script>console.log("Web Inspector page loaded")</script></body></html>` };
}

/** DevTools › Web Inspector: whether WebViews can be inspected here, and the opt-in WebView a person shows on demand. */
export function useWebInspectorDemo() {
  const [optIn, setOptIn] = useState(false);
  return { availability: getWebViewInspectorAvailability(), development: __DEV__, optIn, toggleOptIn: () => setOptIn(shown => !shown) };
}
