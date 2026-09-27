import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { testConfig } from "./platform-test-config";
import { WebView } from "@legendapp/spark/webview";
const source = { html: '<html><body><p id="value">WebView acceptance</p></body></html>' };
export default function DesktopLibraryChecks({ check, onError, onBusy }: { check: (id: string, action: () => Promise<void>) => Promise<void>; onError: (message: string) => void; onBusy: (busy: boolean) => void }) {
  const [activeSource, setActiveSource] = useState<typeof source | { uri: string } | null>(null);
  const [feedback, setFeedback] = useState("Check WebView load, JavaScript injection, native messaging and unmount.");
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  async function run() {
    onBusy(true);
    try {
      await check("desktop.webview", async () => {
        for (const nextSource of [source, ...(testConfig.reportURL ? [{ uri: `${testConfig.reportURL}/webview` }] : [])]) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const message = new Promise<void>((resolve, reject) => { pending.current = { resolve, reject }; timer = setTimeout(() => reject(new Error("WebView did not report within 20 seconds")), 20000); });
            setActiveSource(nextSource); await message;
          } finally { clearTimeout(timer); pending.current = null; setActiveSource(null); }
        }
        setFeedback("WebView loaded and reported. Verify this button remains clickable after unmount.");
      });
    } catch (error) { onError(String(error)); } finally { onBusy(false); }
  }
  return <View style={{ gap: 8 }}><Text>{feedback}</Text>
    <Button disabled={!!activeSource} onPress={() => void run()}>Check WebView</Button>
    {activeSource && <WebView source={activeSource} style={{ height: 180 }}
      injectedJavaScript="document.getElementById('value').textContent = 'native-to-web'; window.ReactNativeWebView.postMessage(document.getElementById('value').textContent); true;"
      onMessage={event => { if (event.data === "native-to-web") pending.current?.resolve(); else pending.current?.reject(new Error(`Unexpected WebView message: ${event.data}`)); }}
      onError={event => pending.current?.reject(new Error(event.message))} />}
  </View>;
}
