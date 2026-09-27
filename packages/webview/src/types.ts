import type { StyleProp, ViewStyle } from "react-native";
export type WebViewSource =
  | { uri: string; headers?: Record<string, string>; html?: never; baseUri?: never }
  | { html: string; baseUri?: string; uri?: never; headers?: never };
export type WebViewMessageEvent = { data: string; uri: string };
export type WebViewNavigation = { uri: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean };
export type WebViewNavigationRequest = { uri: string; mainFrame: boolean | null };
export type WebViewErrorEvent =
  | { type: "load"; uri: string; code: number; message: string }
  | { type: "http"; uri: string; status: number; message: string };
export interface WebViewProps {
  source: WebViewSource;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
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
export interface WebViewRef {
  reload(): void;
  goBack(): void;
  goForward(): void;
  postMessage(message: string): void;
  injectJavaScript(script: string): void;
}
