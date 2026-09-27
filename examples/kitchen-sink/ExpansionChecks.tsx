import React, { useEffect, useRef } from "react";
import { Text, View, TurboModuleRegistry, type TurboModule } from "react-native";
import { WebView } from "@legendapp/spark/webview";
import { writeText } from "@legendapp/spark/files";
import { runExpansionChecks } from "./expansion-checks";
import { DragDropView } from "@legendapp/spark/drag-drop";
import { showMessage } from "@legendapp/spark/dialogs";
const dragSource = { text: "Drag this text" };
const driver = TurboModuleRegistry.get<TurboModule & { call(method: string, args: string): Promise<string> }>("NativeSDKTestDriver");
const source = { html: '<html><body><p id="value">initial</p></body></html>' };
const injection = "document.getElementById('value').textContent='native-to-web'; window.ReactNativeWebView.postMessage(document.getElementById('value').textContent); true;";
export function ExpansionChecks({ report }: { report: string }) {
  const webMessage = useRef("");
  const webError = useRef("");
  const drop = useRef<unknown>(null), ended = useRef(false);
  useEffect(() => {
    const results: { name: string; passed: boolean; error?: string }[] = [];
    const check = async (name: string, action: () => Promise<void>) => {
      try { await action(); results.push({ name, passed: true }); }
      catch (error) { results.push({ name, passed: false, error: String(error) }); }
    };
    void (async () => {
      await runExpansionChecks(check);
      await check("WebView mounts, executes JavaScript and sends a native message", async () => {
        const deadline = Date.now() + 15000;
        while (!webMessage.current && !webError.current && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (webMessage.current !== "native-to-web") throw new Error(webError.current || `Missing WebView message: ${webMessage.current}`);
      });
      if (driver) {
        await check("drag source hit testing and native drop events reach JavaScript", async () => {
          await driver.call("dragDrop", "{}");
          const deadline = Date.now() + 3000;
          while ((!drop.current || !ended.current) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
          const value = drop.current as { text?: string; x?: number; y?: number } | null;
          if (value?.text !== "Native drag regression" || value.x !== 12 || value.y !== 14 || !ended.current) throw new Error(`Missing drag events: ${JSON.stringify(value)}, ended=${ended.current}`);
        });
        await check("native confirmation sheet resolves its explicit button and checkbox", async () => {
          const message = showMessage({ title: "Regression confirmation", windowId: "main", buttons: ["Cancel", "Keep"], checkbox: { label: "Remember", checked: true } });
          // Consume rejection even if the native driver fails before we await the sheet.
          void message.catch(() => undefined);
          const deadline = Date.now() + 3000;
          while (true) {
            try { await driver.call("acceptMessage", "{}"); break; }
            catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 50)); }
          }
          const result = await message;
          if (result.button !== 1 || !result.checked) throw new Error(JSON.stringify(result));
        });
      }
      await writeText(report, JSON.stringify({ passed: results.every(result => result.passed), results }));
    })().catch(error => void writeText(report, JSON.stringify({ passed: false, error: String(error), results })));
  }, [report]);
  return <View style={{ flex: 1 }} className="bg-background"><Text className="text-foreground">Desktop expansion integration checks</Text>
    <DragDropView testID="expansion-drop-target" onDrop={event => { drop.current = event; }} style={{ height: 70 }}><Text className="text-foreground">Drop target</Text></DragDropView>
    <DragDropView testID="expansion-drag-source" source={dragSource} onDragEnd={event => { ended.current = event.accepted; }} style={{ height: 70, alignItems: "center", justifyContent: "center" }}><Text className="text-foreground">Drag source child text</Text></DragDropView>
    <WebView source={source} injectedJavaScript={injection} onMessage={event => { webMessage.current = event.data; }} onError={event => { webError.current = event.message; }} style={{ height: 200 }} />
  </View>;
}
