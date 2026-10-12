import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/system/macos");
// Launch arguments go into the process's argument domain only (docs/test-driver.md#pinned-host-settings).
const PINNED = ["-NSRequiresAquaSystemAppearance", "YES", "-AppleAccentColor", "4", "-AppleHighlightColor", "0.698039 0.843137 1.000000 Blue",
  "-increaseContrast", "NO", "-reduceTransparency", "NO", "-differentiateWithoutColor", "NO", "-reduceMotion", "NO", "-AppleInterfaceStyle", "Light", "-AppleInterfaceStyleSwitchesAutomatically", "NO"];
const CHANGED = ["-NSRequiresAquaSystemAppearance", "YES", "-AppleAccentColor", "0", "-AppleHighlightColor", "1.000000 0.874510 0.701961 Orange",
  "-increaseContrast", "YES", "-reduceTransparency", "YES", "-differentiateWithoutColor", "YES", "-reduceMotion", "YES", "-AppleInterfaceStyle", "Dark", "-AppleInterfaceStyleSwitchesAutomatically", "YES"];

test.skipIf(process.platform !== "darwin")("appearance preferences read the user's settings as AppKit resolves them, and simulated values replace only their fields", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spark-appearance-native-"));
  try {
    const binary = path.join(directory, "test");
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-DSPARK_TEST_DRIVER=1", "-I", macos, "-framework", "AppKit",
      path.join(root, "tests/appearance-preferences.native.mm"), path.join(macos, "SparkAppearancePreferences.mm"), "-o", binary], { timeout: 60000 });
    const read = async (args: string[]) => (await runOk(binary, args, { timeout: 30000 })).trim().split("\n").map(line => JSON.parse(line));
    const [pinned, simulated] = await read(PINNED);
    expect(pinned).toMatchObject({ appearance: "light", automaticAppearance: false, accentColor: "#007aff", highlightColor: "#b3d7ff",
      increaseContrast: false, reduceTransparency: false, differentiateWithoutColor: false, reduceMotion: false });
    expect(typeof pinned.invertColors).toBe("boolean");
    expect(typeof pinned.keyboardNavigation).toBe("boolean");
    expect(simulated).toEqual({ ...pinned, accentColor: "#123456", invertColors: true, keyboardNavigation: false });
    const [changed] = await read(CHANGED);
    expect(changed).toMatchObject({ appearance: "dark", automaticAppearance: true, increaseContrast: true, reduceTransparency: true, differentiateWithoutColor: true, reduceMotion: true });
    // Red accent and orange highlight; the exact shades follow the contrast setting.
    expect(changed.accentColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(changed.accentColor).not.toBe(pinned.accentColor);
    expect(changed.highlightColor).not.toBe(pinned.highlightColor);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 90000);
