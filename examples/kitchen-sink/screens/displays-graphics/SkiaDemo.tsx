import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { Canvas, Circle, Rect, Skia, useCanvasRef } from "@shopify/react-native-skia";

// Test IDs: displays-graphics-skia-passed, or -failed with the failing cases.
const ID = "displays-graphics-skia";

function pixel(image: ReturnType<typeof Skia.Image.MakeImageFromEncoded>, x: number, y: number) {
  const pixels = image?.readPixels(x, y, { width: 1, height: 1, colorType: 4, alphaType: 1 });
  return pixels ? Array.from(pixels).slice(0, 3).join() : "none";
}

/** @shopify/react-native-skia through its own API; it builds for macOS upstream. */
export function SkiaDemo() {
  const canvas = useCanvasRef();
  const [result, setResult] = useState<string>();
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        // Offscreen raster: a red square with a blue circle.
        const surface = Skia.Surface.Make(64, 64)!;
        const paint = Skia.Paint();
        paint.setColor(Skia.Color("red"));
        surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 64, 64), paint);
        paint.setColor(Skia.Color("blue"));
        surface.getCanvas().drawCircle(32, 32, 16, paint);
        surface.flush();
        const raster = surface.makeImageSnapshot();
        // On-screen Canvas, read back from the native view.
        const shown = await canvas.current?.makeImageSnapshotAsync();
        const failures = [
          pixel(raster, 2, 2) !== "255,0,0" && `raster corner (${pixel(raster, 2, 2)})`,
          pixel(raster, 32, 32) !== "0,0,255" && `raster circle (${pixel(raster, 32, 32)})`,
          !shown && "canvas snapshot",
          shown && pixel(shown, Math.floor(shown.width() / 2), Math.floor(shown.height() / 2)) !== "0,128,0" && `canvas center (${pixel(shown, Math.floor(shown.width() / 2), Math.floor(shown.height() / 2))})`,
        ].filter(Boolean);
        setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed");
      } catch (error) { setResult(`failed: ${String(error)}`); }
    }, 500);
    return () => clearTimeout(timer);
  }, [canvas]);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">A Skia Canvas (green circle on yellow) and an offscreen raster surface, both read back by pixel.</Text>
    <Canvas ref={canvas} style={{ width: 160, height: 160 }}>
      <Rect x={0} y={0} width={160} height={160} color="yellow" />
      <Circle cx={80} cy={80} r={50} color="green" />
    </Canvas>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
