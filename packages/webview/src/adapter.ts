import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { WebViewProps as BackendProps } from "react-native-webview";
import type { WebViewProps, WebViewRef } from "./types";

const allowedProps = new Set(["source", "style", "testID", "accessibilityLabel", "javaScriptEnabled", "injectedJavaScript", "allowedOrigins", "onMessage", "onLoad", "onError", "onNavigationChange", "onNavigationRequest"]);
export function backendProps(props: WebViewProps): BackendProps {
  for (const key of Object.keys(props)) {
    if (!allowedProps.has(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported WebView prop: ${key}`);
  }
  const { source } = props;
  if (!source || (typeof source.uri === "string") === (typeof source.html === "string")) {
    throw new SparkError("E_INVALID_ARGUMENT", "WebView source must specify either uri or html");
  }
  return {
    source: typeof source.html === "string" ? { html: source.html, baseUrl: source.baseUri } : { uri: source.uri!, headers: source.headers },
    style: props.style, testID: props.testID, accessibilityLabel: props.accessibilityLabel,
    javaScriptEnabled: props.javaScriptEnabled ?? true,
    injectedJavaScript: props.injectedJavaScript,
    originWhitelist: props.allowedOrigins ? [...props.allowedOrigins] : typeof source.html === "string" ? ["*"] : ["http://*", "https://*"],
    onMessage: props.onMessage ? ({ nativeEvent: event }) => props.onMessage!({ data: event.data, uri: event.url }) : undefined,
    onLoad: props.onLoad ? ({ nativeEvent: event }) => props.onLoad!({ uri: event.url }) : undefined,
    onError: props.onError ? ({ nativeEvent: event }) => props.onError!({ type: "load", uri: event.url, code: event.code, message: event.description }) : undefined,
    onHttpError: props.onError ? ({ nativeEvent: event }) => props.onError!({ type: "http", uri: event.url, status: event.statusCode, message: event.description }) : undefined,
    onNavigationStateChange: props.onNavigationChange ? event => props.onNavigationChange!({ uri: event.url, title: event.title, loading: event.loading, canGoBack: event.canGoBack, canGoForward: event.canGoForward }) : undefined,
    onShouldStartLoadWithRequest: props.onNavigationRequest ? event => props.onNavigationRequest!({ uri: event.url, mainFrame: typeof event.isTopFrame === "boolean" ? event.isTopFrame : null }) : undefined,
  };
}

export function webViewRef(current: () => WebViewRef | null): WebViewRef {
  function view() {
    const value = current();
    if (!value) throw new SparkError("E_CLOSED", "WebView is not mounted");
    return value;
  }
  return {
    reload: () => view().reload(), goBack: () => view().goBack(), goForward: () => view().goForward(),
    postMessage(message) {
      if (typeof message !== "string") throw new SparkError("E_INVALID_ARGUMENT", "WebView messages must be strings");
      view().postMessage(message);
    },
    injectJavaScript(script) {
      if (typeof script !== "string") throw new SparkError("E_INVALID_ARGUMENT", "WebView scripts must be strings");
      view().injectJavaScript(script);
    },
  };
}
