import { expect, test, vi } from "vitest";
import { backendProps, webViewRef } from "../packages/webview/src/adapter";
import type { WebViewProps, WebViewRef } from "../packages/webview/src/types";

test("WebView adapter maps source, callbacks and owned errors without native envelopes", () => {
  const onMessage = vi.fn(), onLoad = vi.fn(), onError = vi.fn(), onNavigationChange = vi.fn();
  const onNavigationRequest = vi.fn(() => false);
  const props = backendProps({ source: { html: "hello", baseUri: "https://example.com" }, onMessage, onLoad, onError, onNavigationChange, onNavigationRequest });
  expect(props.source).toEqual({ html: "hello", baseUrl: "https://example.com" });
  expect(props.javaScriptEnabled).toBe(true);
  props.onMessage!({ nativeEvent: { data: "hello", url: "https://example.com", nativeDetail: "private" } } as never);
  expect(onMessage).toHaveBeenCalledWith({ data: "hello", uri: "https://example.com" });
  props.onLoad!({ nativeEvent: { url: "about:blank" } } as never);
  expect(onLoad).toHaveBeenCalledWith({ uri: "about:blank" });
  props.onError!({ nativeEvent: { url: "u", code: -1, description: "failed" } } as never);
  props.onHttpError!({ nativeEvent: { url: "u", statusCode: 404, description: "missing" } } as never);
  expect(onError.mock.calls).toEqual([[{ type: "load", uri: "u", code: -1, message: "failed" }], [{ type: "http", uri: "u", status: 404, message: "missing" }]]);
  expect(props.onShouldStartLoadWithRequest!({ url: "u" } as never)).toBe(false);
  expect(onNavigationRequest).toHaveBeenCalledWith({ uri: "u", mainFrame: null });
});

test("backend-only props do not leak through the Spark adapter", () => {
  expect(() => backendProps({ source: { uri: "https://example.com" }, nativeConfig: { secret: true } } as WebViewProps)).toThrow(/Unsupported WebView prop/);
  const props = backendProps({ source: { uri: "https://example.com" } });
  expect(props.originWhitelist).toEqual(["http://*", "https://*"]);
  expect(() => backendProps({ source: { uri: "u", html: "h" } } as never)).toThrow(/either/);
});

test("owned ref delegates only while mounted and validates string commands", () => {
  const backend = { reload: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), postMessage: vi.fn(), injectJavaScript: vi.fn() };
  let current: WebViewRef | null = backend;
  const ref = webViewRef(() => current);
  ref.reload(); ref.postMessage("hello");
  expect(backend.reload).toHaveBeenCalledTimes(1);
  expect(backend.postMessage).toHaveBeenCalledWith("hello");
  expect(() => ref.postMessage({} as never)).toThrow(/strings/);
  current = null;
  expect(() => ref.goBack()).toThrow(/not mounted/);
});
