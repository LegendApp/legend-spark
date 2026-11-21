import { expect, test } from "vitest";
import { nativePackages } from "../packages/cli/src/project.ts";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const xcode = require("xcode");
const { installHostFiles, installHostProject } = require("../packages/config-plugin/macos-host.cjs");
const { removeExpoApplicationAlias } = require("../packages/config-plugin/native-patches.cjs");
const template = path.join(path.dirname(require.resolve("expo-desktop-template-bare-minimum/package.json")), "macos");

test("the SwiftUI template host is replaced by Spark's AppKit host files", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-macos-host-"));
  try {
    cpSync(template, root, { recursive: true });
    installHostFiles(root);
    const host = path.join(root, "HelloWorld-macOS");
    expect(existsSync(path.join(host, "AppDelegate.swift"))).toBe(false);
    expect(readFileSync(path.join(host, "AppDelegate.mm"), "utf8")).toContain("jsBundleURLForBundleRoot");
    for (const name of ["AppDelegate.h", "main.m", "Main.storyboard"]) expect(existsSync(path.join(host, name))).toBe(true);
    installHostFiles(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the macOS target compiles the AppKit host and its menu storyboard", () => {
  const project = xcode.project(path.join(template, "HelloWorld.xcodeproj/project.pbxproj")).parseSync();
  installHostProject(project);
  const contents = project.writeSync();
  expect(contents).not.toContain("AppDelegate.swift");
  installHostProject(project);
  expect(project.writeSync()).toBe(contents);
  const objects = project.hash.project.objects;
  const macOS = Object.values(objects.PBXNativeTarget).find((target: any) => target.name?.replaceAll('"', "") === "HelloWorld-macOS") as any;
  const phase = (isa: string) => macOS.buildPhases.map((entry: any) => objects[isa][entry.value]).find(Boolean);
  const files = (isa: string) => phase(isa).files.map((file: any) => objects.PBXFileReference[objects.PBXBuildFile[file.value].fileRef]);
  expect(files("PBXSourcesBuildPhase").map((file: any) => file.path.replaceAll('"', "")).sort()).toEqual(["AppDelegate.mm", "main.m"]);
  expect(files("PBXResourcesBuildPhase").find((file: any) => file.path === '"Main.storyboard"').lastKnownFileType).toBe("file.storyboard");
  const group = Object.values(objects.PBXGroup).find((entry: any) => entry.path?.replaceAll('"', "") === "HelloWorld-macOS") as any;
  expect(group.children.map((child: any) => child.comment)).toEqual(expect.arrayContaining(["AppDelegate.mm", "main.m", "Main.storyboard"]));
});

test("Expo's duplicate UIApplication alias is removed before native fingerprinting", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-expo-alias-"));
  try {
    const write = (file: string, contents: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), contents); };
    write("node_modules/react-native-macos/package.json", "{}");
    write("node_modules/react-native-macos/ReactApple/Libraries/RCTUIKit/RCTUIKitCompat.h", "@compatibility_alias UIApplication NSApplication;\n");
    write("node_modules/expo-modules-core/package.json", "{}");
    const header = "#import <Foundation/Foundation.h>\n\n#ifndef UIApplication\n@compatibility_alias UIApplication NSApplication;\n#endif\n";
    write("node_modules/expo-modules-core/ios/Platform/Platform.h", header);
    const roots = [path.join(root, "node_modules/react-native-macos"), path.join(root, "node_modules/expo-modules-core")];
    removeExpoApplicationAlias(...roots);
    const patched = readFileSync(path.join(root, "node_modules/expo-modules-core/ios/Platform/Platform.h"), "utf8");
    expect(patched).toBe("#import <Foundation/Foundation.h>\n\n\n");
    removeExpoApplicationAlias(...roots);
    expect(readFileSync(path.join(root, "node_modules/expo-modules-core/ios/Platform/Platform.h"), "utf8")).toBe(patched);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("macOS native preparation patches Expo Constants in the selected pod copy", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-expo-computer-name-"));
  try {
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    };
    write(path.join(root, "package.json"), JSON.stringify({ dependencies: { "react-native-macos": "0.83.0", expo: "55.0.32" } }));
    write(path.join(root, "node_modules/react-native-macos/package.json"), JSON.stringify({ name: "react-native-macos", version: "0.83.0" }));
    const expo = path.join(root, "node_modules/expo");
    write(path.join(expo, "package.json"), JSON.stringify({ name: "expo", version: "55.0.32", dependencies: { "expo-modules-core": "55.0.27" } }));
    const expoCore = path.join(expo, "node_modules/expo-modules-core");
    write(path.join(expoCore, "package.json"), JSON.stringify({ name: "expo-modules-core", version: "55.0.27" }));
    write(path.join(expoCore, "ExpoModulesCore.podspec"), "");
    const provider = path.join(expoCore, "ios/Utilities/ConstantsProvider.swift");
    write(provider, `internal final class ConstantsProvider: EXConstantsInterface {}

private func getDeviceName() -> String {
  #if os(iOS) || os(tvOS)
  return UIDevice.current.name
  #elseif os(macOS)
  return ProcessInfo.processInfo.hostName
  #endif
}
`);
    expect(nativePackages(root).find(pkg => pkg.name === "expo-modules-core")?.root).toBe(realpathSync(expoCore));
    const patched = readFileSync(provider, "utf8");
    expect(patched).toContain("#if os(macOS)\nimport SystemConfiguration\n#endif");
    expect(patched).toContain("return UIDevice.current.name");
    expect(patched).toContain('return SCDynamicStoreCopyComputerName(nil, nil) as String? ?? ""');
    expect(patched).not.toContain("ProcessInfo.processInfo.hostName");
    nativePackages(root);
    expect(readFileSync(provider, "utf8")).toBe(patched);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
