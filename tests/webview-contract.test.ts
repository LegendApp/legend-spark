import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ platform: { OS: "macos" }, module: true as boolean }));
vi.mock("react-native", () => ({ Platform: mocks.platform, TurboModuleRegistry: { get: (name: string) => mocks.module && name === "RNCWebViewModule" ? {} : null } }));
import { backendProps, webViewRef } from "../packages/webview/src/adapter";
import { getWebViewInspectorAvailability } from "../packages/webview/src/inspector";
import { viewPropKeys } from "../packages/webview/src/view-props";
import type { WebViewProps, WebViewRef } from "../packages/webview/src/types";
const globals = globalThis as { __DEV__?: boolean };
beforeEach(() => { mocks.platform.OS = "macos"; mocks.module = true; globals.__DEV__ = true; });

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

test("React Native view props reach the backend view", () => {
  const onLayout = vi.fn();
  const props = backendProps({ source: { uri: "https://example.com" }, testID: "preview", accessibilityRole: "image", hitSlop: 4, onLayout });
  expect(props.testID).toBe("preview");
  expect(props.accessibilityRole).toBe("image");
  expect(props.hitSlop).toBe(4);
  expect(props.onLayout).toBe(onLayout);
  // Unset view props are omitted rather than forwarded as undefined.
  expect(Object.keys(props)).not.toContain("nativeID");
  expect(() => backendProps({ source: { uri: "https://example.com" }, startInLoadingState: true } as unknown as WebViewProps)).toThrow(/Unsupported WebView prop/);
});

test("the forwarded view prop list is React Native's own", () => {
  expect(viewPropKeys).toContain("onPointerDown");
  expect(viewPropKeys).not.toContain("children");
  expect(new Set(viewPropKeys).size).toBe(viewPropKeys.length);
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

test("the Web Inspector is available on macOS with the WebView module", () => {
  expect(getWebViewInspectorAvailability()).toEqual({ available: true });
  mocks.module = false; expect(getWebViewInspectorAvailability()).toEqual({ available: false, reason: "missing-module" });
  mocks.platform.OS = "windows"; expect(getWebViewInspectorAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
});

test("WebViews are inspectable in development bundles by default and in release bundles only when they opt in", () => {
  const source = { html: "inspect me" };
  expect(backendProps({ source }).webviewDebuggingEnabled).toBe(true);
  expect(backendProps({ source, inspectable: false }).webviewDebuggingEnabled).toBe(false);
  globals.__DEV__ = false;
  expect(backendProps({ source }).webviewDebuggingEnabled).toBe(false);
  expect(backendProps({ source, inspectable: true }).webviewDebuggingEnabled).toBe(true);
  expect(() => backendProps({ source, inspectable: "yes" } as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});

test("where the Web Inspector is unavailable an unset inspectable keeps the backend default and a set one throws", () => {
  const source = { html: "inspect me" };
  mocks.platform.OS = "windows";
  expect(backendProps({ source })).not.toHaveProperty("webviewDebuggingEnabled");
  for (const value of [true, false]) expect(() => backendProps({ source, inspectable: value })).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  mocks.platform.OS = "macos"; mocks.module = false;
  expect(() => backendProps({ source, inspectable: true })).toThrow(expect.objectContaining({ code: "E_MODULE_UNAVAILABLE" }));
});
