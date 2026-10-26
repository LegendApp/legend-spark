import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const base = "::Microsoft::ReactNative::Composition::Experimental::IComponentViewInterop>";
export function patchWindowsGeometry(source: string) {
  if (source.includes("// SPARK GEOMETRY ABI")) return source;
  if (!source.includes(base) || !source.includes("  virtual RECT getClientRect() const noexcept;")) throw new Error("The pinned RNW ComponentView changed; review the Spark geometry adapter before upgrading");
  return source.replace('#include <ComponentView.Experimental.interop.h>', '#include <ComponentView.Experimental.interop.h>\n#include <SparkComponentGeometry.h>')
    .replace(base, "::Microsoft::ReactNative::Composition::Experimental::IComponentViewInterop, ::ISparkComponentGeometry>")
    .replace("  virtual RECT getClientRect() const noexcept;", `  virtual RECT getClientRect() const noexcept;
  // SPARK GEOMETRY ABI
  RECT __stdcall SparkClientRect() noexcept override { return getClientRect(); }
  int64_t __stdcall SparkHitTest(float x, float y, float *localX, float *localY) noexcept override {
    facebook::react::Point local;
    const auto tag = hitTest({x, y}, local);
    *localX = local.x; *localY = local.y; return tag;
  }`);
}
export function prepareWindowsGeometry(root: string) {
  const req = createRequire(path.join(root, "package.json"));
  const manifest = req.resolve("react-native-windows/package.json");
  if (JSON.parse(readFileSync(manifest, "utf8")).version !== "0.83.2") throw new Error("spark's Windows geometry adapter requires react-native-windows 0.83.2");
  const rnw = path.dirname(manifest), source = path.join(rnw, "Microsoft.ReactNative/Fabric/ComponentView.h");
  const original = readFileSync(source, "utf8"); const patched = patchWindowsGeometry(original);
  if (patched !== original) writeFileSync(source, patched);
  const header = readFileSync(createRequire(import.meta.url).resolve("@legendapp/spark-desktop-host/windows/SparkComponentGeometry.h"), "utf8");
  writeFileSync(path.join(rnw, "Microsoft.ReactNative.Cxx/SparkComponentGeometry.h"), header);
}
