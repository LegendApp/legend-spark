import { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView as BackendWebView } from "react-native-webview";
import { backendProps, webViewRef } from "./adapter";
import type { WebViewProps, WebViewRef } from "./types";

/** Spark-owned props, events and ref; backend-specific APIs remain private. */
export const WebView = forwardRef<WebViewRef, WebViewProps>(function WebView(props, ref) {
  const native = useRef<BackendWebView>(null);
  useImperativeHandle(ref, () => webViewRef(() => native.current), []);
  return <BackendWebView {...backendProps(props)} ref={native} />;
});
