import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import SignatureCanvas, { type SignatureViewRef } from "react-native-signature-canvas";

// Test IDs: the screen reads the pad until the WebView answers; an empty pad reports -empty, a drawn one -ok.
const ID = "displays-graphics-signature-canvas";

/** react-native-signature-canvas: a drawing pad in react-native-webview, read back through its message bridge. */
export function SignatureCanvasDemo() {
  const ref = useRef<SignatureViewRef>(null);
  const [result, setResult] = useState("");
  useEffect(() => { if (result) return; const timer = setInterval(() => ref.current?.readSignature(), 500); return () => clearInterval(timer); }, [result]);
  return <View className="flex-1 bg-background p-6 gap-3">
    <Text className="text-sm text-muted">Draw with the mouse, then read the signature. An untouched pad reports empty.</Text>
    <View style={{ height: 240, borderWidth: 1, borderColor: "#d1d5db" }}>
      <SignatureCanvas ref={ref} onOK={data => setResult(data.startsWith("data:image/png;base64,") ? "ok" : "bad")} onEmpty={() => setResult("empty")} webStyle=".m-signature-pad--footer { display: none; }" />
    </View>
    <Pressable testID={`${ID}-read`} onPress={() => ref.current?.readSignature()} style={{ padding: 12, borderRadius: 8, backgroundColor: "#3b82f6", alignSelf: "flex-start" }}><Text style={{ color: "white" }}>Read signature</Text></Pressable>
    <Text className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result}` : undefined}>{`result ${result || "none"}`}</Text>
  </View>;
}
