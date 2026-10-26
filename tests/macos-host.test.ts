import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const xcode = require("xcode");
const { installHostFiles, installHostProject } = require("../packages/config-plugin/macos-host.cjs");
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
