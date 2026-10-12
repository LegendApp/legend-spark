import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

// Builds a background-only app (LSBackgroundOnly: it never activates or shows a window) from the real
// SparkLocalization.mm, the desktop template's Main.storyboard and Spark's strings, with its own bundle ID.
test.skipIf(process.platform !== "darwin")("the template menu, app languages and per-app language resolve in the launch language", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-localization-"));
  const identifier = `test.spark.localization.${randomUUID()}`;
  try {
    const app = path.join(directory, "Probe.app"), contents = path.join(app, "Contents"), resources = path.join(contents, "Resources");
    const strings = path.join(resources, "SparkStrings.bundle/Contents");
    mkdirSync(path.join(contents, "MacOS"), { recursive: true }); mkdirSync(path.join(resources, "Base.lproj"), { recursive: true }); mkdirSync(path.join(strings, "Resources"), { recursive: true });
    execFileSync("clang++", ["-std=c++20", "-fobjc-arc", "-framework", "AppKit", "-I", path.join(root, "packages/desktop-app/macos"), path.join(root, "tests/framework-strings.native.mm"), path.join(root, "packages/desktop-app/macos/SparkLocalization.mm"), "-o", path.join(contents, "MacOS/probe")]);
    const template = path.join(path.dirname(createRequire(path.join(root, "packages/config-plugin/package.json")).resolve("expo-desktop-template-bare-minimum/package.json")), "macos/HelloWorld-macOS/Base.lproj/Main.storyboard");
    execFileSync("xcrun", ["ibtool", "--compile", path.join(resources, "Base.lproj/Main.storyboardc"), template]);
    for (const language of ["en", "ar", "fr"]) cpSync(path.join(root, `packages/desktop-app/macos/Localization/${language}.lproj`), path.join(strings, `Resources/${language}.lproj`), { recursive: true });
    const plist = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${entries}</dict></plist>`;
    writeFileSync(path.join(strings, "Info.plist"), plist("<key>CFBundleIdentifier</key><string>test.spark.strings</string><key>CFBundleDevelopmentRegion</key><string>en</string><key>CFBundlePackageType</key><string>BNDL</string>"));
    writeFileSync(path.join(contents, "Info.plist"), plist(`<key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>probe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleName</key><string>Probe</string><key>CFBundleDevelopmentRegion</key><string>en</string><key>CFBundleLocalizations</key><array><string>en</string><string>ar</string><string>fr</string></array><key>NSMainStoryboardFile</key><string>Main</string><key>NSPrincipalClass</key><string>NSApplication</string><key>LSBackgroundOnly</key><true/>`));
    const probe = (...args: string[]) => execFileSync(path.join(contents, "MacOS/probe"), args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n");
    const languages = (lines: string[]) => JSON.parse(lines.find(line => line.startsWith("languages="))!.slice("languages=".length));

    const english = probe("-AppleLanguages", "(en)");
    expect(english).toEqual(expect.arrayContaining(["Probe > About Probe", "Probe > Quit Probe", "Edit > Undo", "Edit > Select All", "Window > Minimize", "Help > Probe Help", "OK=OK Cancel=Cancel Search=Search"]));
    expect(languages(english)).toEqual({ supported: ["en", "ar", "fr"], current: "en", override: null, framework: ["ar", "en", "fr"] });
    expect(english).toContain('missing key raises: Spark has no native string "Not a Spark string"');

    const arabic = probe("-AppleLanguages", "(ar)");
    expect(arabic).toEqual(expect.arrayContaining(["Probe > حول Probe", "Probe > إنهاء Probe‎", "تعديل > تراجع", "تعديل > تحديد الكل", "نافذة > تصغير", "مساعدة > مساعدة Probe", "OK=موافق Cancel=إلغاء Search=بحث"]));
    expect(arabic.some(line => /^(Edit|File|Window)( >|$)/.test(line))).toBe(false);
    expect(languages(arabic).current).toBe("ar");

    const french = probe("-AppleLanguages", "(fr)");
    expect(french).toEqual(expect.arrayContaining(["Probe > À propos de Probe", "Édition > Annuler", "Fenêtre > Minimiser", "Aide > Aide Probe", "OK=OK Cancel=Annuler Search=Rechercher"]));
    // A language the app lists nowhere: AppKit and Spark use the development language.
    expect(probe("-AppleLanguages", "(de)")).toEqual(expect.arrayContaining(["Edit > Undo"]));

    // The per-app language: stored in the app's own defaults, applied at the next launch, removed with null.
    expect(probe("set", "de")).toContain("set de -> NO");
    expect(probe("set", "ar")).toContain("set ar -> YES");
    const stored = probe();
    expect(stored).toContain("تعديل > تراجع");
    expect(languages(stored)).toMatchObject({ current: "ar", override: "ar" });
    expect(probe("set", "none")).toContain("set none -> YES");
    expect(languages(probe())).toMatchObject({ current: "en", override: null });
  } finally {
    // An emptied domain keeps its file, which `defaults delete` refuses; remove both.
    try { execFileSync("defaults", ["delete", identifier], { stdio: "ignore" }); } catch { /* no keys left */ }
    rmSync(path.join(os.homedir(), "Library/Preferences", `${identifier}.plist`), { force: true });
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
