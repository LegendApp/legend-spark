import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRegistry, type PatchRegistry, type RegistryVersion } from "../packages/config-plugin/patch-registry.cjs";

export function generateRegistry(root: string): PatchRegistry {
  const read = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
  const registryFile = path.join(root, "patches/registry.json");
  const registry: PatchRegistry = existsSync(registryFile) ? validateRegistry(JSON.parse(readFileSync(registryFile, "utf8"))) : { schema: 1, libraries: {} };
  const minSpark = read("packages/desktop/package.json").version;
  function add(name: string, kind: "patch" | "sdk" | "redirect", pin: RegistryVersion) {
    const entry = { ...pin, minSpark: pin.minSpark ?? minSpark };
    if (entry.sdkPatch) entry.sdkSha256 = createHash("sha256").update(readFileSync(path.join(root, "patches", entry.sdkPatch))).digest("hex");
    if (entry.patch) entry.sha256 = createHash("sha256").update(readFileSync(path.join(root, "patches", entry.patch))).digest("hex");
    const library = registry.libraries[name] ??= { kind, versions: [] };
    if (library.kind !== kind) throw new Error(`Registry kind changed: ${name}`);
    const previous = library.versions.find(version => version.version === entry.version && version.minSpark === entry.minSpark);
    if (!previous) library.versions.push(entry);
    else if (JSON.stringify(Object.entries(previous).sort()) !== JSON.stringify(Object.entries(entry).sort())) throw new Error(`Patch changed without a new minSpark: ${name}@${entry.version}. Preserve old patch files and add a new entry.`);
  }
  for (const [name, pin] of Object.entries(read("patches/dependencies.json")) as [string, any][]) {
    const { version, patch, integrity, requires, optional } = pin;
    add(name, "patch", { version, minSpark, patch, ...(integrity ? { integrity } : {}), ...(requires ? { requires } : {}), ...(optional !== undefined ? { optional } : {}) });
  }
  const camera = read("patches/camera/upstream.json");
  for (const name of ["react-native-nitro-modules", "react-native-nitro-image", "react-native-vision-camera"]) {
    add(name, "patch", { version: camera[name].version, minSpark, patch: `camera/${name}.patch`, integrity: camera[name].integrity,
      ...(name === "react-native-nitro-modules" ? { sdkPatch: `workspace/react-native-nitro-modules@${camera[name].version}.patch` } : {}),
      requires: name === "react-native-vision-camera" ? ["react-native-nitro-modules", "react-native-nitro-image"] : ["react-native-nitro-modules"] });
  }
  const workspace = read("package.json").sparkWorkspacePatches;
  for (const [key, file] of Object.entries(workspace) as [string, string][]) {
    const at = key.lastIndexOf("@"), name = key.slice(0, at);
    if (name === "react-native-nitro-modules") continue;
    add(name, "sdk", { version: key.slice(at + 1), minSpark, patch: file.replace(/^patches\//, "") });
  }
  const dependencies = read("package.json").devDependencies;
  for (const name of ["expo-clipboard", "expo-document-picker"]) add(name, "redirect", { version: dependencies[name], minSpark });
  registry.libraries = Object.fromEntries(Object.entries(registry.libraries).sort(([a], [b]) => a.localeCompare(b)));
  return validateRegistry(registry);
}

export function validateRegistryFiles(root: string, registry: PatchRegistry) {
  validateRegistry(registry);
  const listed = new Set<string>();
  for (const library of Object.values(registry.libraries)) for (const entry of library.versions) {
    for (const [file, expected] of [[entry.patch, entry.sha256], [entry.sdkPatch, entry.sdkSha256]]) {
      if (!file) continue;
      listed.add(file);
      const bytes = readFileSync(path.join(root, "patches", file));
      if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error(`Registry disagrees with patch file: ${file}`);
    }
  }
  for (const file of readdirSync(path.join(root, "patches"))) {
    if (/@[^@]+\.patch$/.test(file) && !listed.has(file)) throw new Error(`Patch missing from registry: ${file}`);
  }
  for (const file of readdirSync(path.join(root, "patches/workspace"))) {
    if (file.endsWith(".patch") && !listed.has(`workspace/${file}`)) throw new Error(`Patch missing from registry: workspace/${file}`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const registry = generateRegistry(root);
  validateRegistryFiles(root, registry);
  writeFileSync(path.join(root, "patches/registry.json"), JSON.stringify(registry, null, 2) + "\n");
}
