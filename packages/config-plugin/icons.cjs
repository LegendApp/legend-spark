// App icons for desktop builds (docs/configuration.md#app-icons). macOS takes macos.icon, else the Expo icon; Windows
// takes the Expo icon (expoByPlatform.windows can override it). Without one, the template's placeholder icon stays.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

/** macOS app icon slots: each point size at 1x and 2x. */
const MACOS_SIZES = [16, 32, 128, 256, 512];
/** Windows .ico sizes: the title bar, taskbar, Start and Explorer at 100% to 200% scaling. */
const WINDOWS_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const PNG_SIGNATURE = "89504e470d0a1a0a";

/** The configured icon, or undefined. `kind` is "icon" for an Icon Composer document, else "png". */
function iconSource(config, projectRoot, platform) {
  const value = platform === "macos" ? config.macos?.icon ?? config.icon : config.icon;
  if (value === undefined) return undefined;
  const key = platform === "macos" && config.macos?.icon !== undefined ? "macos.icon" : "icon";
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a path to a PNG${platform === "macos" ? " or an Icon Composer .icon document" : ""}`);
  const file = path.resolve(projectRoot, value);
  if (/\.icon\/?$/i.test(value)) {
    if (platform !== "macos") throw new Error(`${key}: an Icon Composer .icon document is a macOS icon; give Windows a PNG`);
    if (!fs.existsSync(path.join(file, "icon.json"))) throw new Error(`${key}: ${value} is not an Icon Composer document (no icon.json)`);
    return { file, kind: "icon" };
  }
  if (!fs.existsSync(file) || fs.readFileSync(file).subarray(0, 8).toString("hex") !== PNG_SIGNATURE) throw new Error(`${key}: ${value} is not a PNG file`);
  return { file, kind: "png" };
}

/** A digest of the icon's contents, so editing it in place prepares the native project again. */
function iconDigest(config, projectRoot, platform) {
  const source = iconSource(config, projectRoot, platform);
  if (!source) return undefined;
  const hash = createHash("sha256");
  const files = source.kind === "icon" ? fs.readdirSync(source.file, { recursive: true }).map(String).sort() : [""];
  for (const name of files) {
    const file = path.join(source.file, name);
    if (fs.statSync(file).isFile()) hash.update(`${name}\0`).update(fs.readFileSync(file));
  }
  return hash.digest("hex");
}

const images = () => require("@expo/image-utils");
/** The PNG scaled to cover a size×size square. */
async function square(src, size) {
  return (await images().generateImageAsync({ projectRoot: path.dirname(src) }, { src, width: size, height: size, resizeMode: "cover" })).source;
}
/** Full-bleed artwork: every corner is opaque, so it has no shape of its own for the system to keep. */
async function fullBleed(src) {
  const { data, width, height } = await images().getPngInfo(src);
  return [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].every(([x, y]) => data[(y * width + x) * 4 + 3] === 255);
}

/** An Icon Composer document with the artwork as its one layer, so the system masks it and derives the dark, clear and tinted styles. */
function writeIconDocument(directory, artwork) {
  fs.mkdirSync(path.join(directory, "Assets"), { recursive: true });
  fs.writeFileSync(path.join(directory, "Assets/Artwork.png"), artwork);
  fs.writeFileSync(path.join(directory, "icon.json"), JSON.stringify({
    fill: { solid: "srgb:0.00000,0.00000,0.00000,1.00000" },
    groups: [{
      layers: [{ "image-name": "Artwork.png", name: "Artwork", glass: false }],
      shadow: { kind: "none", opacity: 0 },
      specular: false,
      translucency: { enabled: false, value: 0 },
    }],
    "supported-platforms": { squares: "shared" },
  }, null, 2) + "\n");
}

/** The asset catalog AppIcon set with the artwork in every slot. */
async function writeIconSet(directory, src) {
  fs.mkdirSync(directory, { recursive: true });
  const entries = [];
  for (const size of MACOS_SIZES) for (const scale of [1, 2]) {
    const filename = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
    fs.writeFileSync(path.join(directory, filename), await square(src, size * scale));
    entries.push({ filename, idiom: "mac", scale: `${scale}x`, size: `${size}x${size}` });
  }
  fs.writeFileSync(path.join(directory, "Contents.json"), JSON.stringify({ images: entries, info: { author: "xcode", version: 1 } }, null, 2) + "\n");
}

/**
 * macOS: an Icon Composer document becomes the target's AppIcon.icon resource, which actool compiles into the dark,
 * clear and tinted styles plus the flat icons older macOS uses. Full-bleed PNG artwork is wrapped in one; PNG artwork
 * with its own shape (transparent corners) fills every AppIcon.appiconset slot instead.
 */
async function applyMacOSIcon(project, nativeRoot, source) {
  const catalogs = fs.readdirSync(nativeRoot).map(name => path.join(nativeRoot, name, "Assets.xcassets")).filter(directory => fs.existsSync(directory));
  if (catalogs.length !== 1) throw new Error(`Expected one macOS asset catalog for the app icon, found ${catalogs.length}`);
  const appRoot = path.dirname(catalogs[0]), group = path.basename(appRoot);
  const iconSet = path.join(catalogs[0], "AppIcon.appiconset"), document = path.join(appRoot, "AppIcon.icon");
  fs.rmSync(iconSet, { recursive: true, force: true });
  fs.rmSync(document, { recursive: true, force: true });
  if (source.kind === "png" && !(await fullBleed(source.file))) return writeIconSet(iconSet, source.file);
  if (source.kind === "icon") fs.cpSync(source.file, document, { recursive: true });
  else writeIconDocument(document, await square(source.file, 1024));
  const groupKey = project.findPBXGroupKey({ path: group }) ?? project.findPBXGroupKey({ path: JSON.stringify(group) });
  const target = project.findTargetKey(group) ?? project.findTargetKey(JSON.stringify(group));
  if (!groupKey || !target) throw new Error(`The macOS project has no ${group} group and target for AppIcon.icon`);
  const file = project.addFile("AppIcon.icon", groupKey, { lastKnownFileType: "folder.iconcomposer.icon" });
  file.uuid = project.generateUuid();
  file.target = target;
  project.addToPbxBuildFileSection(file);
  project.addToPbxResourcesBuildPhase(file);
}

/** Windows: every .ico of the app project (the executable's icon resource among them) gets each size in WINDOWS_SIZES. */
async function applyWindowsIcon(nativeRoot, source) {
  const icons = fs.readdirSync(nativeRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .flatMap(entry => fs.readdirSync(path.join(nativeRoot, entry.name)).filter(name => name.toLowerCase().endsWith(".ico")).map(name => path.join(nativeRoot, entry.name, name)));
  if (!icons.length) throw new Error("The Windows project has no .ico files to replace with the app icon");
  const ico = await images().generateFaviconAsync(await square(source.file, 1024), WINDOWS_SIZES);
  for (const file of icons) fs.writeFileSync(file, ico);
}

function withDesktopIcon(config, platform) {
  // Without an icon the template's own stays and no mod is added.
  if ((platform === "macos" ? config.macos?.icon ?? config.icon : config.icon) === undefined) return config;
  if (platform === "windows") {
    const { withMod } = require("@expo/config-plugins");
    return withMod(config, { platform: "windows", mod: "dangerous", action: async mod => {
      const source = iconSource(mod, mod.modRequest.projectRoot, "windows");
      if (source) await applyWindowsIcon(mod.modRequest.platformProjectRoot, source);
      return mod;
    } });
  }
  const { withXcodeProject } = require("expo-desktop-config-plugins");
  return withXcodeProject(config, async mod => {
    const source = iconSource(mod, mod.modRequest.projectRoot, "macos");
    if (source) await applyMacOSIcon(mod.modResults, mod.modRequest.platformProjectRoot, source);
    return mod;
  });
}

module.exports = { withDesktopIcon, iconSource, iconDigest, applyMacOSIcon, applyWindowsIcon, MACOS_SIZES, WINDOWS_SIZES };
