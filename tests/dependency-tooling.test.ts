import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

test("Metro's image parser retains Buffer and file-path asset contracts", async () => {
  const { getAssetSize, getAssetData } = require("metro/private/Assets");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXkAAAAASUVORK5CYII=", "base64");
  expect(getAssetSize("png", png, "pixel.png")).toEqual({ width: 1, height: 1 });
  expect(getAssetSize("svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="34"></svg>'), "vector.svg")).toEqual({ width: 12, height: 34 });
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-metro-asset-"));
  try {
    const file = path.join(root, "pixel.png"); writeFileSync(file, png);
    expect(await getAssetData(file, "pixel.png", [], null, "/assets")).toMatchObject({ width: 1, height: 1, type: "png" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the React Native CLI reads launcher activities with the updated XML parser", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-android-manifest-"));
  try {
    const file = path.join(root, "AndroidManifest.xml");
    const pkg = require.resolve("@react-native-community/cli-config-android/package.json");
    const { default: getMainActivity } = require(path.join(path.dirname(pkg), "build/config/getMainActivity.js"));
    const manifest = (activities: string) => `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application>${activities}</application></manifest>`;
    writeFileSync(file, manifest('<activity android:name=".Settings"/><activity android:name=".Main"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity>'));
    expect(getMainActivity(file)).toBe(".Main");
    writeFileSync(file, manifest('<activity android:name=".Settings"/>'));
    expect(getMainActivity(file)).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the pinned web renderer can render with the app's React baseline", () => {
  const React = require("react");
  const { renderToString } = require("react-dom/server");
  expect(renderToString(React.createElement("strong", null, "Spark"))).toBe("<strong>Spark</strong>");
});
