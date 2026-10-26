// Expo Desktop 55's template hosts React Native in a SwiftUI App. Spark keeps its AppKit
// host: AppDelegate.mm replaces the Swift delegate, with main.m and the menu storyboard.
const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig } = require("@expo/config-plugins");

function installHostFiles(platformRoot) {
  for (const swift of fs.readdirSync(platformRoot).map((name) => path.join(platformRoot, name, "AppDelegate.swift")).filter((file) => fs.existsSync(file))) {
    for (const name of ["AppDelegate.h", "main.m", "Main.storyboard"])
      fs.copyFileSync(require.resolve(`@legendapp/spark-desktop-host/macos/${name}`), path.join(path.dirname(swift), name));
    // Upstream AppDelegate mods expect an Objective-C delegate; Spark's withAppDelegate owns its final contents.
    fs.copyFileSync(require.resolve("@legendapp/spark-desktop-host/AppDelegate.mm"), path.join(path.dirname(swift), "AppDelegate.mm"));
    fs.rmSync(swift);
  }
}

function installHostProject(project) {
  const objects = project.hash.project.objects, references = project.pbxFileReferenceSection(), builds = project.pbxBuildFileSection();
  const key = Object.keys(references).find((id) => references[id].path === "AppDelegate.swift");
  if (!key) return project;
  Object.assign(references[key], { path: "AppDelegate.mm", lastKnownFileType: "sourcecode.cpp.objcpp" });
  references[`${key}_comment`] = "AppDelegate.mm";
  const build = Object.keys(builds).find((id) => builds[id].fileRef === key);
  Object.assign(builds[build], { fileRef_comment: "AppDelegate.mm" });
  builds[`${build}_comment`] = "AppDelegate.mm in Sources";
  const group = Object.values(objects.PBXGroup).find((entry) => entry.children?.some((child) => child.value === key));
  group.children.find((child) => child.value === key).comment = "AppDelegate.mm";
  for (const phase of Object.values(objects.PBXSourcesBuildPhase)) for (const file of phase.files ?? []) if (file.value === build) file.comment = "AppDelegate.mm in Sources";
  // The template also has an iOS target; add the host to the target that compiled the Swift delegate.
  const targetUuid = Object.keys(objects.PBXNativeTarget).find((id) => objects.PBXNativeTarget[id].buildPhases?.some((phase) =>
    objects.PBXSourcesBuildPhase[phase.value]?.files?.some((file) => file.value === build)));
  IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: "main.m", groupName: group.path.replaceAll('"', ""), project, targetUuid });
  IOSConfig.XcodeUtils.addResourceFileToGroup({ filepath: "Main.storyboard", groupName: group.path.replaceAll('"', ""), project, isBuildFile: true, targetUuid });
  const storyboard = Object.keys(references).find((id) => references[id].path === '"Main.storyboard"');
  references[storyboard].lastKnownFileType = "file.storyboard";
  return project;
}

module.exports = { installHostFiles, installHostProject };
