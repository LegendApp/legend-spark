import type { ViewProps } from "react-native";
/** What a `WebView` loads: a `uri` (with optional request headers) or inline `html` (with an optional `baseUri`), never both. */
export type WebViewSource =
  | { uri: string; headers?: Record<string, string>; html?: never; baseUri?: never }
  | { html: string; baseUri?: string; uri?: never; headers?: never };
/** Passed to `onMessage`: the string the page posted and the URL of the page that posted it. */
export type WebViewMessageEvent = { data: string; uri: string };
/** Passed to `onNavigationChange`: the current page and the back/forward state. */
export type WebViewNavigation = { uri: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean };
/** Passed to `onNavigationRequest`. `mainFrame` is null when the backend does not say. */
export type WebViewNavigationRequest = { uri: string; mainFrame: boolean | null };
/** Passed to `onError`: `load` for a failed load, `http` for an HTTP error status. */
export type WebViewErrorEvent =
  | { type: "load"; uri: string; code: number; message: string }
  | { type: "http"; uri: string; status: number; message: string };
/** React Native's view props are accepted; WebView-specific behavior is owned here. Children are not: the rendered content is the source document. */
export interface WebViewProps extends Omit<ViewProps, "children"> {
  source: WebViewSource;
  javaScriptEnabled?: boolean;
  /** Script executed after page load. Applies to trusted document content. */
  injectedJavaScript?: string;
  /** Origin patterns accepted by the current adapter; default is HTTP/HTTPS. Inline HTML permits all origins. */
  allowedOrigins?: readonly string[];
  onMessage?: (event: WebViewMessageEvent) => void;
  onLoad?: (event: { uri: string }) => void;
  onError?: (event: WebViewErrorEvent) => void;
  onNavigationChange?: (event: WebViewNavigation) => void;
  /** Synchronous native navigation decision where emitted; not a network security boundary. */
  onNavigationRequest?: (event: WebViewNavigationRequest) => boolean;
}
/** Ref methods of a `WebView`. Each throws E_CLOSED when the view is not mounted; `postMessage` and `injectJavaScript` take strings (E_INVALID_ARGUMENT). */
export interface WebViewRef {
  reload(): void;
  goBack(): void;
  goForward(): void;
  postMessage(message: string): void;
  injectJavaScript(script: string): void;
}
