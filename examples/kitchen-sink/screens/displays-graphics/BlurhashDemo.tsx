import { useEffect, useState } from "react";
import { ScrollView, Text, UIManager } from "react-native";
import { Blurhash } from "react-native-blurhash";
import { toByteArray } from "base64-js";
import { getDirectory, writeBytes } from "@legendapp/spark/files";

// Test IDs: displays-graphics-blurhash-decoded once the native view reports onLoadEnd;
// displays-graphics-blurhash-encoded when encoding a local red PNG gives a valid, red Blurhash.
const ID = "displays-graphics-blurhash";
const HASH = "LGFFaXYk^6#M@-5c,1J5@[or[Q6.";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4z8DwHxkzoAsAAA8hD/EEN8afAAAAAElFTkSuQmCC";

/** react-native-blurhash through its own API; Spark adds the AppKit view and NSImage codec. */
export function BlurhashDemo() {
  const [decoded, setDecoded] = useState<string>();
  const [encoded, setEncoded] = useState<string>();
  useEffect(() => {
    void (async () => {
      const file = `${await getDirectory("data")}/blurhash-demo.png`;
      await writeBytes(file, toByteArray(PNG));
      const hash = await Blurhash.encode(`file://${file}`, 4, 3);
      const color = Blurhash.getAverageColor(hash);
      setEncoded(Blurhash.isBlurhashValid(hash).isValid && color?.r === 255 && color.g === 0 && color.b === 0 ? `ok ${hash}` : `failed ${hash} ${JSON.stringify(color)}`);
    })().catch(error => setEncoded(`failed ${String(error)}`));
  }, []);
  const registered = UIManager.hasViewManagerConfig("BlurhashView");
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">{`Native BlurhashView registered: ${registered ? "yes" : "no"}`}</Text>
    <Blurhash blurhash={HASH} resizeMode="cover" style={{ width: 240, height: 160, borderRadius: 8 }}
      onLoadEnd={() => setDecoded("ok")} onLoadError={message => setDecoded(`failed ${message}`)} />
    <Text selectable className="font-mono text-xs text-foreground" testID={decoded === "ok" ? `${ID}-decoded` : undefined}>{`decode: ${decoded ?? "…"}`}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={encoded?.startsWith("ok") ? `${ID}-encoded` : undefined}>{`encode: ${encoded ?? "…"}`}</Text>
  </ScrollView>;
}
