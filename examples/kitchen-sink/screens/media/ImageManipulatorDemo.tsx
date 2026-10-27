import { useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { FlipType, ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Skia } from "@shopify/react-native-skia";
import { toByteArray } from "base64-js";
import { getDirectory, writeBytes } from "@legendapp/spark/files";

// Test IDs: media-image-manipulator-passed, or -failed with the failing cases. Offline: the source is a
// 2×1 PNG (red, blue) written to the app's data folder; results are decoded with Skia and read by pixel.
const ID = "media-image-manipulator";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8AAQv8BD/kD/YURmXYAAAAASUVORK5CYII=";

type Context = ReturnType<typeof ImageManipulator.manipulate>;

async function pixels(context: Context) {
  const result = await (await context.renderAsync()).saveAsync({ format: SaveFormat.PNG, base64: true });
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(result.base64!))!;
  const colors = [];
  for (let y = 0; y < image.height(); y++) for (let x = 0; x < image.width(); x++) {
    const [r, , b] = image.readPixels(x, y, { width: 1, height: 1, colorType: 4, alphaType: 1 })!;
    colors.push(r > 200 && b < 50 ? "R" : b > 200 && r < 50 ? "B" : "?");
  }
  return { size: `${result.width}x${result.height}`, colors: colors.join(""), uri: result.uri };
}

async function check(uri: string) {
  const cases = {
    rotate: await pixels(ImageManipulator.manipulate(uri).rotate(90)),
    flip: await pixels(ImageManipulator.manipulate(uri).flip(FlipType.Horizontal)),
    resize: await pixels(ImageManipulator.manipulate(uri).resize({ width: 4 })),
    crop: await pixels(ImageManipulator.manipulate(uri).crop({ originX: 1, originY: 0, width: 1, height: 1 })),
  };
  // Resizing interpolates, so only its outer columns are exact.
  const expected = { rotate: ["1x2", /^RB$/], flip: ["2x1", /^BR$/], resize: ["4x2", /^R..BR..B$/], crop: ["1x1", /^B$/] } as const;
  const failures = (Object.keys(expected) as (keyof typeof cases)[])
    .filter(name => cases[name].size !== expected[name][0] || !expected[name][1].test(cases[name].colors))
    .map(name => `${name} (${cases[name].size} ${cases[name].colors})`);
  return { failures, uris: Object.values(cases).map(result => result.uri) };
}

/** expo-image-manipulator through its own API; Spark's patch draws with CoreGraphics on macOS. */
export function ImageManipulatorDemo() {
  const [result, setResult] = useState<string>();
  const [uris, setUris] = useState<string[]>([]);
  useEffect(() => {
    void (async () => {
      const file = `${await getDirectory("data")}/image-manipulator-demo.png`;
      await writeBytes(file, toByteArray(PNG));
      const { failures, uris } = await check(`file://${file}`);
      setUris(uris);
      return failures;
    })().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`));
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Rotates, flips, resizes and crops a 2×1 red and blue PNG, then reads each saved result by pixel.</Text>
    <View style={{ flexDirection: "row", gap: 16 }}>{uris.map(uri => <Image key={uri} source={{ uri }} style={{ width: 64, height: 64 }} resizeMode="contain" />)}</View>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
