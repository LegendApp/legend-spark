import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { packageManager, managerCommand, applyOverrides, localArchive } from "./package-manager.ts";
// Standalone bootstrap, copied into SDK bundles. Requires Node; no framework checkout.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const root = import.meta.dirname;
const metadata = JSON.parse(readFileSync(path.join(root, "sdk.json"), "utf8"));
const actual: Record<string, string> = {};
function visit(relative: string) {
  const file = path.join(root, relative), stat = lstatSync(file);
  if (stat.isDirectory()) for (const name of readdirSync(file).sort()) visit(path.join(relative, name));
  else {
    let content: string | Buffer;
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(file);
      if (!path.resolve(path.dirname(file), target).startsWith(root + path.sep)) throw new Error("SDK symlink escapes bundle");
      content = `symlink:${target}`;
    } else if (stat.isFile()) content = readFileSync(file);
    else throw new Error("Unsupported SDK file");
    actual[relative.replaceAll(path.sep, "/")] = createHash("sha256").update(content).digest("hex");
  }
}
for (const name of ["packages", "runtimes"]) if (existsSync(path.join(root, name))) visit(name);
if (metadata.schema !== 1 || JSON.stringify(actual) !== JSON.stringify(metadata.sha256)) throw new Error("SDK checksum mismatch");
const manifest = JSON.parse(readFileSync(path.join(root, "packages/manifest.json"), "utf8"));
const overrides: Record<string, string> = {};
for (const [name, file] of Object.entries(manifest)) {
  if (typeof file !== "string" || path.basename(file) !== file || !actual[`packages/${file}`]) throw new Error("Invalid SDK manifest");
  overrides[name] = localArchive(path.join(root, "packages", file));
}
if (!overrides["@legendapp/spark"]) throw new Error("SDK has no CLI");
const tooling = path.join(root, ".cli");
mkdirSync(tooling, { recursive: true });
const { values } = parseArgs({ options: { "package-manager": { type: "string" } } });
const manager = packageManager(root, values["package-manager"]);
const builds = ["@legendapp/spark", "react-native-enriched-markdown", "fsevents"];
const pkg = { name: "spark-sdk-tools", private: true, pnpm: { onlyBuiltDependencies: builds }, dependencies: { ...metadata.tooling?.dependencies, "@legendapp/spark": overrides["@legendapp/spark"] } };
applyOverrides(pkg, { ...metadata.tooling?.overrides, ...overrides }, manager);
if (manager === "pnpm") builds.push(`@legendapp/spark@file:${path.relative(tooling, overrides["@legendapp/spark"]!.slice(5)).replaceAll("\\", "/")}`);
writeFileSync(path.join(tooling, "package.json"), JSON.stringify(pkg, null, 2));
if (manager === "yarn") writeFileSync(path.join(tooling, ".yarnrc.yml"), "nodeLinker: node-modules\n");
if (manager === "pnpm") {
  const allowBuilds = Object.fromEntries(builds.map(name => [name, true]));
  writeFileSync(path.join(tooling, "pnpm-workspace.yaml"), JSON.stringify({ nodeLinker: "hoisted", overrides: (pkg as any).pnpm.overrides, allowBuilds }));
}
const [executable, ...args] = managerCommand(manager, ["install"]);
// Only fixed manager names + 'install' use a Windows shell; paths/CLI arguments
// are always passed directly to Node without shell interpolation.
const install = spawnSync(executable!, args, { cwd: tooling, stdio: "inherit", env: { ...process.env, ...(manager === "yarn" ? { YARN_ENABLE_IMMUTABLE_INSTALLS: "false" } : {}) }, shell: process.platform === "win32" && executable === manager });
if (install.error || install.status !== 0) throw new Error(`SDK CLI installation failed: ${install.error ?? install.status}`);
const cli = path.join(tooling, "node_modules/@legendapp/spark/bin/spark.cjs");
const register = spawnSync(process.execPath, [cli, "sdk", "import", root], { cwd: root, stdio: "inherit" });
if (register.error || register.status !== 0) throw new Error("SDK registration failed");
console.log(`SDK installed. Keep this directory in place.\nCreate an app: node ${JSON.stringify(cli)} create MyApp --universal --package-manager ${manager}`);
