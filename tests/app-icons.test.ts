import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { toExpo } from "../packages/config-plugin/config.cjs";
import { MACOS_SIZES, WINDOWS_SIZES, applyMacOSIcon, applyWindowsIcon, iconDigest, iconSource } from "../packages/config-plugin/icons.cjs";
import { Failure } from "../scripts/e2e/runner/backend.ts";
import { assertAppIcon, executableIconSizes, icnsSizes, type IconReader, type Rendition } from "../scripts/e2e/runner/icons.ts";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as { PNG: { new (options: { width: number; height: number }): { data: Buffer }; sync: { write(png: unknown): Buffer; read(buffer: Buffer): { width: number; height: number } } } };
const xcode = require("xcode") as { project(file: string): XcodeProject };
type XcodeProject = { parseSync(): XcodeProject; writeSync(): string; hasFile(name: string): unknown };

const temporary = () => mkdtempSync(path.join(tmpdir(), "app-icons-"));
/** A size×size PNG: opaque everywhere, or with transparent corners. */
function png(file: string, { size = 1024, corners = 255 } = {}) {
  const image = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (y * size + x) * 4, edge = (x < 4 || x >= size - 4) && (y < 4 || y >= size - 4);
    image.data.set([240, 120, 40, edge ? corners : 255], at);
  }
  writeFileSync(file, PNG.sync.write(image));
  return file;
}
const dimensions = (file: string) => { const { width, height } = PNG.sync.read(readFileSync(file)); return `${width}x${height}`; };
/** The pixel sizes of an .ico file's directory. */
const icoSizes = (bytes: Buffer) => Array.from({ length: bytes.readUInt16LE(4) }, (_, index) => bytes[6 + index * 16] || 256).sort((a, b) => a - b);

/** The macOS project the pinned template generates, copied so a test can change it. */
function macProject() {
  const native = path.join(temporary(), "macos");
  cpSync(path.join(require.resolve("expo-desktop-template-bare-minimum/package.json"), "../macos"), native, { recursive: true });
  const file = path.join(native, "HelloWorld.xcodeproj/project.pbxproj");
  return { native, file, project: xcode.project(file).parseSync(), app: path.join(native, "HelloWorld-macOS") };
}
const base = { name: "Icons", projectId: "icons", version: "1.0.0", macos: { bundleIdentifier: "com.example.icons" } };

describe("app icon configuration", () => {
  test("macos.icon is an optional path carried to the Expo config; other values fail", () => {
    expect(toExpo({ ...base, macos: { ...base.macos, icon: "./assets/App.icon" } }).expo.macos?.icon).toBe("./assets/App.icon");
    expect(() => toExpo({ ...base, macos: { ...base.macos, icon: 1 } })).toThrow("macos.icon must be a path");
    expect(() => toExpo({ ...base, macos: { ...base.macos, icon: " " } })).toThrow("macos.icon must be a path");
  });

  test("macOS takes macos.icon, else the Expo icon; Windows takes the Expo icon and refuses an .icon document", () => {
    const root = temporary();
    mkdirSync(path.join(root, "App.icon"));
    writeFileSync(path.join(root, "App.icon/icon.json"), "{}");
    png(path.join(root, "icon.png"), { size: 8 });
    expect(iconSource({}, root, "macos")).toBeUndefined();
    expect(iconSource({ icon: "icon.png" }, root, "macos")).toEqual({ file: path.join(root, "icon.png"), kind: "png" });
    expect(iconSource({ icon: "icon.png", macos: { icon: "App.icon" } }, root, "macos")).toEqual({ file: path.join(root, "App.icon"), kind: "icon" });
    expect(iconSource({ icon: "icon.png", macos: { icon: "App.icon" } }, root, "windows")).toEqual({ file: path.join(root, "icon.png"), kind: "png" });
    expect(() => iconSource({ icon: "App.icon" }, root, "windows")).toThrow("give Windows a PNG");
    writeFileSync(path.join(root, "icon.jpg"), "not a png");
    expect(() => iconSource({ icon: "icon.jpg" }, root, "windows")).toThrow("icon: icon.jpg is not a PNG file");
    expect(() => iconSource({ macos: { icon: "Missing.icon" } }, root, "macos")).toThrow("macos.icon: Missing.icon is not an Icon Composer document");
  });

  test("the icon digest follows the icon's contents, so an in-place edit prepares the project again", () => {
    const root = temporary();
    mkdirSync(path.join(root, "App.icon/Assets"), { recursive: true });
    writeFileSync(path.join(root, "App.icon/icon.json"), "{}");
    writeFileSync(path.join(root, "App.icon/Assets/glyph.svg"), "<svg/>");
    const config = { macos: { icon: "App.icon" } };
    const before = iconDigest(config, root, "macos");
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(path.join(root, "App.icon/Assets/glyph.svg"), "<svg></svg>");
    expect(iconDigest(config, root, "macos")).not.toBe(before);
    expect(iconDigest({}, root, "macos")).toBeUndefined();
  });
});

describe("macOS app icon", () => {
  test("an Icon Composer document becomes the target's AppIcon.icon resource and replaces the asset catalog set", async () => {
    const { native, file, project, app } = macProject();
    const source = path.join(temporary(), "Brand.icon");
    mkdirSync(path.join(source, "Assets"), { recursive: true });
    writeFileSync(path.join(source, "icon.json"), '{"groups":[]}');
    writeFileSync(path.join(source, "Assets/glyph.svg"), "<svg/>");
    await applyMacOSIcon(project, native, { file: source, kind: "icon" });
    expect(readFileSync(path.join(app, "AppIcon.icon/icon.json"), "utf8")).toBe('{"groups":[]}');
    expect(existsSync(path.join(app, "AppIcon.icon/Assets/glyph.svg"))).toBe(true);
    expect(existsSync(path.join(app, "Assets.xcassets/AppIcon.appiconset"))).toBe(false);
    writeFileSync(file, project.writeSync());
    const written = readFileSync(file, "utf8");
    expect(written).toMatch(/\/\* AppIcon\.icon \*\/ = \{isa = PBXFileReference; name = "AppIcon\.icon"; path = "AppIcon\.icon"; sourceTree = "<group>";[^}]*lastKnownFileType = folder\.iconcomposer\.icon;/);
    expect(written.slice(written.indexOf("Begin PBXResourcesBuildPhase"), written.indexOf("End PBXResourcesBuildPhase"))).toContain("/* AppIcon.icon in Resources */");
  });

  test("full-bleed PNG artwork is wrapped in a generated Icon Composer document at 1024 pixels", async () => {
    const { native, project, app } = macProject();
    await applyMacOSIcon(project, native, { file: png(path.join(temporary(), "icon.png"), { size: 1254 }), kind: "png" });
    const document = JSON.parse(readFileSync(path.join(app, "AppIcon.icon/icon.json"), "utf8"));
    expect(document.groups[0].layers).toEqual([{ "image-name": "Artwork.png", name: "Artwork", glass: false }]);
    expect(dimensions(path.join(app, "AppIcon.icon/Assets/Artwork.png"))).toBe("1024x1024");
    expect(project.hasFile("AppIcon.icon")).toBeTruthy();
  }, 60_000);

  test("PNG artwork with transparent corners fills every AppIcon.appiconset slot", async () => {
    const { native, project, app } = macProject();
    await applyMacOSIcon(project, native, { file: png(path.join(temporary(), "icon.png"), { corners: 0 }), kind: "png" });
    const set = path.join(app, "Assets.xcassets/AppIcon.appiconset");
    const { images } = JSON.parse(readFileSync(path.join(set, "Contents.json"), "utf8")) as { images: { filename: string; scale: string; size: string; idiom: string }[] };
    expect(images.map(image => `${image.size}@${image.scale}`)).toEqual(MACOS_SIZES.flatMap(size => [`${size}x${size}@1x`, `${size}x${size}@2x`]));
    for (const image of images) {
      const pixels = Number(image.size.split("x")[0]) * Number.parseInt(image.scale);
      expect(dimensions(path.join(set, image.filename))).toBe(`${pixels}x${pixels}`);
    }
    expect(existsSync(path.join(app, "AppIcon.icon"))).toBe(false);
    expect(project.hasFile("AppIcon.icon")).toBeFalsy();
  }, 60_000);
});

describe("Windows app icon", () => {
  test("every .ico of the app project gets each Windows size", async () => {
    const native = path.join(temporary(), "windows");
    mkdirSync(path.join(native, "MyApp"), { recursive: true });
    for (const name of ["MyApp.ico", "small.ico"]) writeFileSync(path.join(native, "MyApp", name), "placeholder");
    writeFileSync(path.join(native, "MyApp/MyApp.rc"), "unchanged");
    await applyWindowsIcon(native, { file: png(path.join(temporary(), "icon.png")), kind: "png" });
    for (const name of ["MyApp.ico", "small.ico"]) expect(icoSizes(readFileSync(path.join(native, "MyApp", name)))).toEqual([...WINDOWS_SIZES]);
    expect(readFileSync(path.join(native, "MyApp/MyApp.rc"), "utf8")).toBe("unchanged");
  }, 60_000);

  test("a project without .ico files fails instead of building without the icon", async () => {
    const native = path.join(temporary(), "windows");
    mkdirSync(path.join(native, "MyApp"), { recursive: true });
    await expect(applyWindowsIcon(native, { file: png(path.join(temporary(), "icon.png"), { size: 16 }), kind: "png" })).rejects.toThrow("no .ico files");
  });
});

/** An .icns file with these element types. */
function icns(types: string[]) {
  const elements = types.map(type => Buffer.concat([Buffer.from(type, "latin1"), Buffer.from([0, 0, 0, 12]), Buffer.from([1, 2, 3, 4])]));
  const body = Buffer.concat(elements), header = Buffer.alloc(8);
  header.write("icns", 0, "latin1");
  header.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

/** A PE32+ executable whose resources are an RT_ICON directory and an RT_GROUP_ICON with `sizes` (256 is stored as 0). */
function executable(sizes: number[]) {
  const file = Buffer.alloc(0x400);
  file.write("MZ", 0, "latin1");
  file.writeUInt32LE(64, 0x3c);
  file.write("PE\0\0", 64, "latin1");
  file.writeUInt16LE(0x8664, 68);
  file.writeUInt16LE(1, 70);
  file.writeUInt16LE(240, 84);
  const optional = 88;
  file.writeUInt16LE(0x20b, optional);
  file.writeUInt32LE(0x1000, optional + 112 + 16);
  file.writeUInt32LE(0x200, optional + 112 + 20);
  const section = optional + 240;
  file.write(".rsrc", section, "latin1");
  file.writeUInt32LE(0x200, section + 8);
  file.writeUInt32LE(0x1000, section + 12);
  file.writeUInt32LE(0x200, section + 16);
  file.writeUInt32LE(0x200, section + 20);
  const rsrc = 0x200;
  const directory = (at: number, entries: [number, number][]) => {
    file.writeUInt16LE(entries.length, at + 14);
    entries.forEach(([id, target], index) => { file.writeUInt32LE(id, at + 16 + index * 8); file.writeUInt32LE(target >>> 0, at + 20 + index * 8); });
  };
  directory(rsrc, [[3, 0x80000000 | 0x40], [14, 0x80000000 | 0x20]]);
  directory(rsrc + 0x20, [[1, 0x80000000 | 0x60]]);
  directory(rsrc + 0x60, [[1033, 0x80]]);
  file.writeUInt32LE(0x1000 + 0xa0, rsrc + 0x80);
  file.writeUInt32LE(6 + sizes.length * 14, rsrc + 0x84);
  const group = rsrc + 0xa0;
  file.writeUInt16LE(1, group + 2);
  file.writeUInt16LE(sizes.length, group + 4);
  sizes.forEach((size, index) => { file[group + 6 + index * 14] = size % 256; file[group + 7 + index * 14] = size % 256; file.writeUInt16LE(32, group + 12 + index * 14); });
  return file;
}

describe("assertAppIcon", () => {
  test("icns and executable icon sizes are read from the files", () => {
    expect(icnsSizes(icns(["ic11", "ic12", "ic13", "ic14", "ic10", "info"]))).toEqual([32, 64, 256, 512, 1024]);
    expect(() => icnsSizes(Buffer.from("not an icon"))).toThrow("not an .icns file");
    expect(executableIconSizes(executable([256, 16, 48, 32]))).toEqual([16, 32, 48, 256]);
    expect(() => executableIconSizes(Buffer.from("MZ"))).toThrow("no MZ header");
  });

  const stack = (Appearance: string): Rendition => ({ AssetType: "IconImageStack", Name: "AppIcon", Appearance });
  const image = (PixelWidth: number): Rendition => ({ AssetType: "Icon Image", Name: "AppIcon", PixelWidth });
  /** A macOS app on disk with `icns` and an Assets.car whose renditions `reader` reports. */
  function macApp(renditions: Rendition[], plist: Record<string, string> = { CFBundleIconName: "AppIcon", CFBundleIconFile: "AppIcon" }, icnsTypes = ["ic11", "ic13"]) {
    const app = path.join(temporary(), "Fake.app"), resources = path.join(app, "Contents/Resources");
    mkdirSync(resources, { recursive: true });
    writeFileSync(path.join(resources, "AppIcon.icns"), icns(icnsTypes));
    writeFileSync(path.join(resources, "Assets.car"), "");
    const reader: IconReader = { plist: (_app, key) => plist[key], catalog: () => renditions };
    return { app, reader };
  }
  const allSizes = [32, 64, 256, 512, 1024].map(image);
  const failure = (run: () => void) => { try { run(); } catch (error) { return error as Failure; } throw new Error("expected a failure"); };

  test("macOS: an Icon Composer icon with every size and style passes", () => {
    const { app, reader } = macApp([...allSizes, ...["NSAppearanceNameAqua", "NSAppearanceNameDarkAqua", "ISAppearanceTintable"].map(stack), { AssetType: "Icon Image", Name: "Other", PixelWidth: 16 }]);
    expect(() => assertAppIcon({ app, styles: ["default", "dark", "clear", "tinted"] }, "macos", reader)).not.toThrow();
  });

  test("macOS: missing sizes and styles are each named", () => {
    const { app, reader } = macApp([image(32), image(64), stack("NSAppearanceNameAqua")]);
    const error = failure(() => assertAppIcon({ app, styles: ["dark", "tinted"] }, "macos", reader));
    expect(error.kind).toBe("assertion");
    expect(error.message).toContain("has 32, 64 px renditions; missing 256, 512, 1024 px");
    expect(error.message).toContain("no dark style (NSAppearanceNameDarkAqua)");
    expect(error.message).toContain("no tinted style (ISAppearanceTintable)");
  });

  test("macOS: an icon from PNG artwork has no styles, and an app without an icon fails", () => {
    const { app, reader } = macApp(allSizes);
    expect(() => assertAppIcon({ app }, "macos", reader)).not.toThrow();
    expect(failure(() => assertAppIcon({ app, styles: ["dark"] }, "macos", reader)).message).toContain("was not built from an Icon Composer .icon document");
    const bare = macApp([], {});
    expect(failure(() => assertAppIcon({ app: bare.app }, "macos", bare.reader)).message).toContain("the app shows the generic icon");
  });

  test("macOS: an icns-only icon needs every size, and a damaged icns fails", () => {
    const legacy = macApp([], { CFBundleIconFile: "AppIcon" }, ["ic11", "ic12", "ic13", "ic14", "ic10"]);
    expect(() => assertAppIcon({ app: legacy.app }, "macos", legacy.reader)).not.toThrow();
    const partial = macApp([], { CFBundleIconFile: "AppIcon" }, ["ic11"]);
    expect(failure(() => assertAppIcon({ app: partial.app }, "macos", partial.reader)).message).toContain("missing 64, 256, 512, 1024 px");
    const damaged = macApp(allSizes);
    writeFileSync(path.join(damaged.app, "Contents/Resources/AppIcon.icns"), "garbage");
    expect(failure(() => assertAppIcon({ app: damaged.app }, "macos", damaged.reader)).message).toContain("AppIcon.icns: not an .icns file");
  });

  test("Windows: the executable's icon group needs every Windows size", () => {
    const directory = temporary();
    writeFileSync(path.join(directory, "MyApp.exe"), executable([...WINDOWS_SIZES]));
    expect(() => assertAppIcon({ app: directory }, "windows")).not.toThrow();
    writeFileSync(path.join(directory, "MyApp.exe"), executable([16, 32, 48, 256]));
    expect(failure(() => assertAppIcon({ app: path.join(directory, "MyApp.exe") }, "windows")).message).toContain("missing 20, 24, 40, 64 px");
    expect(failure(() => assertAppIcon({ app: directory, styles: ["dark"] }, "windows")).kind).toBe("invalid");
    writeFileSync(path.join(directory, "Helper.exe"), "");
    expect(failure(() => assertAppIcon({ app: directory }, "windows")).message).toContain("has 2 executables");
  });

  test("the Kitchen Sink declares an Icon Composer icon for macOS and a PNG for Windows", () => {
    const root = path.join(import.meta.dirname, "../examples/kitchen-sink");
    const config = JSON.parse(readFileSync(path.join(root, "desktop.config.json"), "utf8"));
    expect(iconSource(config, root, "macos")?.kind).toBe("icon");
    expect(readdirSync(path.join(root, config.macos.icon, "Assets"))).toEqual(["spark.svg"]);
    expect(iconSource(config.expo, root, "windows")?.kind).toBe("png");
  });
});
