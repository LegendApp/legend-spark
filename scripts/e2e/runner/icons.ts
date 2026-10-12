// App icon audit of the build on disk (docs/e2e-flows.md#app-icon-audit): the icon's sizes, and on macOS its Icon
// Composer styles. The runner runs it over `app` itself, with no backend, like the security audits.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { MACOS_SIZES, WINDOWS_SIZES } from "../../../packages/config-plugin/icons.cjs";
import { Failure, type Platform } from "./backend.ts";
import { verdict } from "./security.ts";

/** One rendition of a compiled asset catalog, as `assetutil --info` lists it. */
export type Rendition = { AssetType?: string; Name?: string; Appearance?: string; PixelWidth?: number };
export type IconReader = {
  /** A string value of the app's Info.plist, or undefined. */
  plist(app: string, key: string): string | undefined;
  /** The renditions of a compiled asset catalog (Assets.car). */
  catalog(file: string): Rendition[];
};
export const macIconReader: IconReader = {
  plist: (app, key) => {
    try { return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined; } catch { return undefined; }
  },
  // assetutil ships with macOS (not the Xcode tools), so it is on release-harness machines.
  catalog: file => (JSON.parse(execFileSync("assetutil", ["--info", file], { encoding: "utf8", maxBuffer: 64 << 20 })) as Rendition[]).slice(1),
};

/** The Icon Composer styles a macOS 26 icon can carry, by the appearance its compiled image stack has. Clear and tinted both render the tintable stack. */
const STYLES: Record<string, string> = { default: "NSAppearanceNameAqua", dark: "NSAppearanceNameDarkAqua", clear: "ISAppearanceTintable", tinted: "ISAppearanceTintable" };
/** Pixel sizes every macOS app icon needs: each point size in MACOS_SIZES at 2x (1x draws from the same renditions). */
const MACOS_PIXELS = MACOS_SIZES.map(size => size * 2);

/** ICNS element types and their pixel sizes (the formats macOS still reads). */
const ICNS_TYPES: Record<string, number> = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512, is32: 16, il32: 32, ih32: 48, it32: 128 };
/** The pixel sizes in an .icns file; throws when it is not one. */
export function icnsSizes(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 8 || tag(0) !== "icns" || view.getUint32(4) !== bytes.length) throw new Error("not an .icns file");
  const sizes = new Set<number>();
  for (let at = 8; at < bytes.length;) {
    const length = at + 8 <= bytes.length ? view.getUint32(at + 4) : 0;
    if (length < 8 || at + length > bytes.length) throw new Error(`a damaged element at byte ${at}`);
    if (ICNS_TYPES[tag(at)]) sizes.add(ICNS_TYPES[tag(at)]!);
    at += length;
  }
  return [...sizes].sort((a, b) => a - b);
}

/** The pixel sizes of a Windows executable's first icon group (RT_GROUP_ICON), which Explorer and the taskbar show; throws when it has none. */
export function executableIconSizes(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (why: string): never => { throw new Error(why); };
  if (bytes.length < 64 || view.getUint16(0, true) !== 0x5a4d) fail("not a Windows executable (no MZ header)");
  const pe = view.getUint32(0x3c, true);
  if (pe + 24 > bytes.length || view.getUint32(pe, true) !== 0x4550) fail("not a Windows executable (no PE header)");
  const sections = view.getUint16(pe + 6, true), optional = pe + 24, optionalSize = view.getUint16(pe + 20, true);
  const magic = view.getUint16(optional, true);
  const directories = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : fail("an unknown optional header"));
  const resourceRva = view.getUint32(directories + 2 * 8, true);
  if (!resourceRva) fail("the executable has no resources");
  const table = optional + optionalSize;
  const offsetOf = (rva: number) => {
    for (let index = 0; index < sections; index++) {
      const header = table + index * 40, virtual = view.getUint32(header + 12, true), size = Math.max(view.getUint32(header + 8, true), view.getUint32(header + 16, true));
      if (rva >= virtual && rva < virtual + size) return view.getUint32(header + 20, true) + rva - virtual;
    }
    return fail(`resource address ${rva.toString(16)} is outside every section`);
  };
  const root = offsetOf(resourceRva);
  /** The first entry of a resource directory, or the one with `id`: named entries sort before numbered ones. */
  const entry = (directory: number, id?: number) => {
    const count = view.getUint16(directory + 12, true) + view.getUint16(directory + 14, true);
    for (let index = 0; index < count; index++) {
      const at = directory + 16 + index * 8, name = view.getUint32(at, true), target = view.getUint32(at + 4, true);
      if (id === undefined || (!(name & 0x80000000) && name === id)) return { target: target & 0x7fffffff, directory: !!(target & 0x80000000) };
    }
    return undefined;
  };
  const RT_GROUP_ICON = 14;
  const type = entry(root, RT_GROUP_ICON) ?? fail("the executable has no icon (RT_GROUP_ICON)");
  const group = entry(root + type.target) ?? fail("the icon group is empty");
  const language = group.directory ? entry(root + group.target) ?? fail("the icon group has no data") : group;
  const data = offsetOf(view.getUint32(root + language.target, true));
  const count = view.getUint16(data + 4, true);
  return [...new Set(Array.from({ length: count }, (_, index) => bytes[data + 6 + index * 14] || 256))].sort((a, b) => a - b);
}

/** The executable `app` names: an .exe, or the one .exe in a build directory. */
function executableOf(app: string): string {
  if (statSync(app).isFile()) return app;
  const executables = readdirSync(app).filter(name => name.toLowerCase().endsWith(".exe"));
  if (executables.length !== 1) throw new Failure("invalid", `${app} has ${executables.length} executables; pass the app's .exe`);
  return path.join(app, executables[0]!);
}
const missing = (needed: readonly number[], have: readonly number[]) => needed.filter(size => !have.includes(size));

/**
 * The app's icon has every size the platform draws, and on macOS each Icon Composer style `styles` names. macOS: the
 * asset catalog icon (CFBundleIconName) has 32 to 1024 pixel renditions (16 to 512 points at 2x) and the .icns file
 * (CFBundleIconFile) for older systems is valid. Windows: the executable's icon group has each size in WINDOWS_SIZES.
 */
export function assertAppIcon(args: Record<string, unknown>, platform: Platform, reader: IconReader = macIconReader): void {
  const app = String(args.app), styles = (args.styles ?? []) as string[], problems: string[] = [];
  if (!existsSync(app)) throw new Failure("invalid", `${app} does not exist`);
  if (platform === "windows") {
    if (styles.length) throw new Failure("invalid", "assertAppIcon styles are macOS Icon Composer styles; Windows icons have none");
    const executable = executableOf(app);
    let sizes: number[] = [];
    try { sizes = executableIconSizes(readFileSync(executable)); } catch (error) { problems.push(`${path.basename(executable)}: ${(error as Error).message}`); }
    const absent = missing(WINDOWS_SIZES, sizes);
    if (sizes.length && absent.length) problems.push(`${path.basename(executable)}: the icon has ${sizes.join(", ")} px; missing ${absent.join(", ")} px`);
    return verdict("assertAppIcon", problems);
  }
  const resources = path.join(app, "Contents/Resources");
  const iconName = reader.plist(app, "CFBundleIconName"), iconFile = reader.plist(app, "CFBundleIconFile");
  if (!iconName && !iconFile) return verdict("assertAppIcon", ["Info.plist names no icon (CFBundleIconName or CFBundleIconFile): the app shows the generic icon"]);
  if (iconFile) {
    const file = path.join(resources, iconFile.endsWith(".icns") ? iconFile : `${iconFile}.icns`);
    if (!existsSync(file)) problems.push(`CFBundleIconFile ${iconFile}: ${path.relative(app, file)} is missing`);
    else {
      try {
        const sizes = icnsSizes(readFileSync(file));
        if (!iconName && missing(MACOS_PIXELS, sizes).length) problems.push(`${path.relative(app, file)} has ${sizes.join(", ")} px; missing ${missing(MACOS_PIXELS, sizes).join(", ")} px`);
      } catch (error) { problems.push(`${path.relative(app, file)}: ${(error as Error).message}`); }
    }
  } else problems.push("Info.plist has no CFBundleIconFile: macOS before 10.13 and some views fall back to the generic icon");
  if (!iconName) {
    if (styles.length) problems.push(`no CFBundleIconName: the icon has no asset catalog, so no ${styles.join(", ")} style`);
    return verdict("assertAppIcon", problems);
  }
  const car = path.join(resources, "Assets.car");
  if (!existsSync(car)) return verdict("assertAppIcon", [...problems, `CFBundleIconName ${iconName}: ${path.relative(app, car)} is missing`]);
  const renditions = reader.catalog(car).filter(rendition => rendition.Name === iconName);
  const pixels = [...new Set(renditions.filter(rendition => rendition.AssetType === "Icon Image").map(rendition => rendition.PixelWidth!))].sort((a, b) => a - b);
  if (missing(MACOS_PIXELS, pixels).length) problems.push(`the ${iconName} icon in Assets.car has ${pixels.join(", ") || "no"} px renditions; missing ${missing(MACOS_PIXELS, pixels).join(", ")} px`);
  const stacks = new Set(renditions.filter(rendition => rendition.AssetType === "IconImageStack").map(rendition => rendition.Appearance));
  for (const style of styles) {
    if (!STYLES[style]) throw new Failure("invalid", `assertAppIcon style ${style} is not one of ${Object.keys(STYLES).join(", ")}`);
    if (!stacks.has(STYLES[style])) problems.push(stacks.size ? `the ${iconName} icon has no ${style} style (${STYLES[style]}); it has ${[...stacks].join(", ")}` : `the ${iconName} icon has no ${style} style: it was not built from an Icon Composer .icon document`);
  }
  verdict("assertAppIcon", problems);
}
