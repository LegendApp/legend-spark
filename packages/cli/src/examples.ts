import { packageManager, managerCommand } from "./package-manager.ts";
import { cpSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "./project.ts";
import { run } from "./commands.ts";
export const examples = ["document-editor", "notes-lite", "music-lite", "diff-lite"] as const;
export type Example = typeof examples[number];
export async function configureExample(root: string, example: Example) {
  const pkg = readJson(path.join(root, "package.json"));
  const suffixes = ["desktop-app", "desktop-windows", "desktop-shortcuts", "native-menu", "file-dialog", "message-dialog"];
  if (example === "music-lite") suffixes.push("audio");
  if (example === "diff-lite") suffixes.push("processes");
  const desktop = suffixes.map(name => name === "desktop" ? "@legendapp/spark" : `@legendapp/spark-${name}`);
  if (!pkg.dependencies["@legendapp/spark"]) throw new Error("SDK example requires @legendapp/spark");
  Object.assign(pkg.dependencies, { "expo-document-picker": "58.0.4", "expo-file-system": "58.0.8", "expo-sharing": "58.0.16" });
  if (example !== "document-editor") pkg.dependencies["@react-native-async-storage/async-storage"] = "2.2.0";
  if (example === "music-lite") pkg.dependencies["expo-audio"] = pkg.dependencies["expo-audio"] ?? pkg.overrides?.["expo-audio"] ?? pkg.resolutions?.["expo-audio"] ?? pkg.pnpm?.overrides?.["expo-audio"] ?? "58.0.8";
  if (example === "diff-lite") pkg.dependencies["diff"] = "8.0.2";
  writeJson(path.join(root, "package.json"), pkg);
  const config = readJson(path.join(root, "desktop.config.json"));
  for (const platform of ["ios", "android", "macos", "windows"]) {
    const options = config.expoByPlatform[platform] ??= {};
    const excluded = options.autolinking?.exclude ?? [];
    const extra = ["macos", "windows"].includes(platform) ? ["expo-document-picker", "expo-sharing", "expo-file-system", "expo-audio"] : desktop;
    if (platform === "windows") extra.push(...desktop.filter(name => !["@legendapp/spark-file-dialog", "@legendapp/spark-audio", "@legendapp/spark-desktop-app", "@legendapp/spark-desktop-windows", "@legendapp/spark-desktop-shortcuts", "@legendapp/spark-native-menu"].includes(name)));
    options.autolinking = { ...options.autolinking, exclude: [...new Set([...excluded, ...extra])] };
    if (example === "music-lite" && ["ios", "android"].includes(platform)) options.plugins = [...(options.plugins ?? []), ["expo-audio", { microphonePermission: false, enableBackgroundPlayback: true, recordAudioAndroid: false }]];
  }
  writeJson(path.join(root, "desktop.config.json"), config);
  cpSync(path.resolve(import.meta.dirname, "../templates", example), root, { recursive: true });
  if (example !== "document-editor") {
    cpSync(path.resolve(import.meta.dirname, "../templates/example-shared"), path.join(root, "shared"), { recursive: true });
    writeFileSync(path.join(root, "shared/identity.ts"), `export const projectId = ${JSON.stringify(config.projectId)};\n`);
  }
  await run(root, managerCommand(packageManager(root), ["install"]));
}
