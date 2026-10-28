import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import React, { act } from "react";
import ts from "typescript";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const { create } = require("react-test-renderer");
const absoluteFill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 };
const native = {
  View: "View",
  Image: Object.assign(function Image(props: object) { return React.createElement("Image", props); }, {
    getSize: vi.fn(async () => ({ width: 400, height: 200 })),
    getSizeWithHeaders: vi.fn(async () => ({ width: 400, height: 200 })),
    resolveAssetSource: vi.fn(() => ({ uri: "asset@2x.png", width: 200, height: 100, scale: 2 })),
  }),
  StyleSheet: { create: (styles: object) => styles, absoluteFill },
};

// Exercise the shipped patch source, with only the native host and image loader mocked.
function shim(packageName: string, file: string): any {
  const patch = readFileSync(path.join(import.meta.dirname, `../patches/${packageName}.patch`), "utf8");
  const section = patch.split(`+++ b/src/${file}\n`)[1].split("diff --git ")[0];
  const source = section.split("\n").filter(line => line.startsWith("+")).map(line => line.slice(1)).join("\n");
  const directory = path.join(import.meta.dirname, "../node_modules", packageName.split("@")[0], "src");
  const evaluate = (source: string, filename: string): any => {
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    new Function("require", "module", "exports", code)((name: string) => {
      if (name === "react-native") return native;
      if (name.startsWith(".")) {
        const target = path.resolve(path.dirname(filename), `${name}.ts`);
        return evaluate(readFileSync(target, "utf8"), target);
      }
      return require(name);
    }, module, module.exports);
    return module.exports;
  };
  return evaluate(source, path.join(directory, file));
}

let rendered: any;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  native.Image.getSize.mockResolvedValue({ width: 400, height: 200 });
  native.Image.getSizeWithHeaders.mockReset().mockResolvedValue({ width: 400, height: 200 });
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).startsWith("react-test-renderer is deprecated")) error(...args);
  });
});
afterEach(async () => {
  if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; });
  vi.restoreAllMocks();
});
async function mount(component: any, props: object) {
  await act(async () => { rendered = create(React.createElement(component, props)); });
}
const images = () => rendered.root.findAllByType("Image");
const style = (value: any): any => Object.assign({}, ...(Array.isArray(value) ? value.flat(Infinity).filter(Boolean) : [value]));

test("FastImageBackground routes layout, test and accessibility props to the container and imageProps to the image", async () => {
  const { FastImageBackground } = shim("react-native-fast-image@10.9.9", "index.macos.tsx");
  const onLayout = vi.fn(), onLoad = vi.fn();
  await mount(FastImageBackground, { testID: "background", onLayout, accessibilityLabel: "container", source: { uri: "photo" }, onLoad,
    imageProps: { testID: "image", accessibilityLabel: "photo", onLoad: undefined }, children: "overlay" });
  const views = rendered.root.findAllByType("View");
  expect(views[0].props).toMatchObject({ testID: "background", onLayout, accessibilityLabel: "container" });
  expect(views[1].props).toMatchObject({ testID: "image", accessibilityLabel: "photo" });
  expect(views[1].props.onLayout).toBeUndefined();
  await act(async () => images()[0].props.onLoad({ nativeEvent: { source: { uri: "photo", width: 1, height: 1 } } }));
  expect(onLoad).toHaveBeenCalledWith({ nativeEvent: { width: 400, height: 200 } });
});

test("FastImage configureCache resolves the same explicit unsupported result as cache siblings", async () => {
  const { default: FastImage } = shim("react-native-fast-image@10.9.9", "index.macos.tsx");
  await expect(FastImage.configureCache()).resolves.toEqual({ ok: false, error: "FastImage.configureCache is not supported on macOS" });
});

test.each([7, { uri: "photo", width: 800, height: 600, scale: 2, headers: { Accept: "image/png" } }])(
  "FastImage strips intrinsic layout dimensions from main and placeholder sources: %j", async source => {
    const { default: FastImage } = shim("react-native-fast-image@10.9.9", "index.macos.tsx");
    await mount(FastImage, { source, placeholder: source, style: { width: 120, height: 120 } });
    for (const image of images()) {
      expect(image.props.source).not.toHaveProperty("width");
      expect(image.props.source).not.toHaveProperty("height");
      expect(style(image.props.style)).toMatchObject(absoluteFill);
    }
  },
);

test("expo-image cover/contain and bundled source dimensions leave RN Image filling its container", async () => {
  const { default: ExpoImage } = shim("expo-image@55.0.11", "ExpoImage.macos.tsx");
  await mount(ExpoImage, { source: [{ uri: "asset@2x.png", width: 800, height: 600, scale: 2 }], placeholder: [{ uri: "preview", width: 80, height: 60 }],
    contentFit: "cover", placeholderContentFit: "contain", style: { width: 120, height: 120 } });
  expect(images().map((image: any) => image.props.resizeMode)).toEqual(["contain", "cover"]);
  for (const image of images()) {
    expect(image.props.source).not.toHaveProperty("width");
    expect(image.props.source).not.toHaveProperty("height");
    expect(style(image.props.style)).toEqual(absoluteFill);
  }
});

test("expo-image none centers natural dimensions for an oversized image and placeholder instead of shrinking", async () => {
  const { default: ExpoImage } = shim("expo-image@55.0.11", "ExpoImage.macos.tsx");
  await mount(ExpoImage, { source: [{ uri: "photo" }], placeholder: [{ uri: "preview", scale: 2 }], contentFit: "none", placeholderContentFit: "none",
    style: { width: 120, height: 120 } });
  expect(images().map((image: any) => style(image.props.style))).toEqual([
    { position: "absolute", width: 200, height: 100, left: "50%", top: "50%", right: undefined, bottom: undefined, transform: [{ translateX: -100 }, { translateY: -50 }] },
    { position: "absolute", width: 400, height: 200, left: "50%", top: "50%", right: undefined, bottom: undefined, transform: [{ translateX: -200 }, { translateY: -100 }] },
  ]);
  expect(style(rendered.root.findByType("View").props.style)).toMatchObject({ overflow: "hidden", width: 120, height: 120 });
});


test("expo-image none sizes authenticated sources and ignores a previous source's late size", async () => {
  const { default: ExpoImage } = shim("expo-image@55.0.11", "ExpoImage.macos.tsx");
  let resolvePrevious!: (size: { width: number; height: number }) => void;
  native.Image.getSizeWithHeaders.mockImplementationOnce(() => new Promise(resolve => { resolvePrevious = resolve; }));
  const headers = { Authorization: "fixture" };
  await mount(ExpoImage, { source: [{ uri: "previous", headers }], contentFit: "none" });
  await act(async () => rendered.update(React.createElement(ExpoImage, { source: [{ uri: "next", headers }], contentFit: "none" })));
  expect(native.Image.getSizeWithHeaders).toHaveBeenCalledWith("next", headers);
  expect(style(images()[0].props.style)).toMatchObject({ width: 400, height: 200 });
  await act(async () => resolvePrevious({ width: 900, height: 800 }));
  expect(style(images()[0].props.style)).toMatchObject({ width: 400, height: 200 });
});
