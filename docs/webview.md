# WebView

`@legendapp/spark/webview` exports `WebView`, a native web view component, and its named types (`WebViewProps`, `WebViewRef`, `WebViewSource`, `WebViewMessageEvent`, `WebViewNavigation`, `WebViewNavigationRequest`, `WebViewErrorEvent`). Spark owns the props, events and ref; `react-native-webview` (16.0.0) renders the view behind a private adapter, so its wider prop surface is not part of Spark's API. An application that needs the full upstream surface uses `react-native-webview` directly.

```tsx
import { WebView, type WebViewRef } from '@legendapp/spark/webview';

const web = useRef<WebViewRef>(null);
<WebView
  ref={web}
  source={{ html: '<button onclick="window.ReactNativeWebView.postMessage(\'hi\')">Send</button>' }}
  style={{ height: 240 }}
  onMessage={event => console.log(event.data)}
  onError={event => console.warn(event.type, event.message)}
  onNavigationRequest={request => request.uri === 'about:blank'}
/>
```

## Props

- `source` is either `{ uri, headers? }` or `{ html, baseUri? }`. Passing both or neither throws `E_INVALID_ARGUMENT` during render.
- `javaScriptEnabled` defaults to true. `injectedJavaScript` runs after the page loads; use it only with trusted content.
- `allowedOrigins` lists the origin patterns the view may load. The default is `http://*` and `https://*`, or every origin for an inline `html` source.
- React Native view props (layout, style, accessibility, pointer and responder props) pass through to the native view. Any other prop, including upstream `react-native-webview` props, throws `E_UNSUPPORTED_OPTION`. `children` is not accepted: the view renders its source document.

## Events

- `onMessage({ data, uri })` receives a string the page posted with `window.ReactNativeWebView.postMessage`.
- `onLoad({ uri })` reports a finished load.
- `onError` reports `{ type: 'load', uri, code, message }` for a failed load and `{ type: 'http', uri, status, message }` for an HTTP error response.
- `onNavigationChange({ uri, title, loading, canGoBack, canGoForward })` reports navigation state.
- `onNavigationRequest({ uri, mainFrame })` decides synchronously whether a navigation proceeds: return false to cancel it. `mainFrame` is null where the backend does not report it. This is a navigation decision where the backend emits one, not a network security boundary.

## Ref

`WebViewRef` has `reload()`, `goBack()`, `goForward()`, `postMessage(message)` and `injectJavaScript(script)`. A call after the view unmounts throws `E_CLOSED`, and a message or script that is not a string throws `E_INVALID_ARGUMENT`.

The Kitchen Sink's desktop checks screen embeds one with messaging and a navigation veto (`examples/kitchen-sink/Expansion.tsx`). `tests/webview-contract.test.ts` covers the prop translation and ref errors. On Windows the backend is upstream's WebView2 view with Spark's patches (`patches/windows/webview.patch`); see the [parity audit](desktop-parity-audit.md#external-libraries-integration-versus-api-support) for what is not yet validated per platform.
