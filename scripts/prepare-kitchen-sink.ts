import { packageManager, managerCommand } from "../packages/cli/src/package-manager.ts";
import { cpSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { create, refreshLocalPackages } from "../packages/cli/src/create.ts";
import { readJson, writeJson } from "../packages/cli/src/project.ts";
import { run } from "../packages/cli/src/commands.ts";
import { verifyLocalPackageManifest } from "./verify-local-package-manifest.ts";
const framework = path.resolve(import.meta.dirname, "..");
const source = path.join(framework, "examples/kitchen-sink");

// Integration runners deliberately use a fresh, copied consumer they can modify.
export async function prepareKitchenSink(root: string, packageManifest?: string) {
  const marker = path.join(root, ".spark/kitchen-sink.json");
  if (existsSync(marker) && readJson(marker).mode === "live")
    throw new Error("Use a separate directory for packaged validation; this app links to the live kitchen sink source.");
  return prepareKitchenSinkConsumer(root, packageManifest);
}

async function prepareKitchenSinkConsumer(root: string, packageManifest?: string) {
  const marker = path.join(root, ".spark/kitchen-sink.json");
  if (existsSync(path.join(root, "package.json")) && !existsSync(marker))
    throw new Error(`Refusing to overwrite an existing app. Choose a new kitchen-sink directory: ${root}`);
  const manifest = packageManifest ? path.resolve(packageManifest) : path.join(framework, "artifacts/packages/manifest.json");
  if (packageManifest) {
    const verified = await verifyLocalPackageManifest(framework, manifest);
    console.log(`Using verified local SDK archive ${verified.sdkFile} (sha256 ${verified.sdkSha256}).`);
  }
  else await run(framework, [process.execPath, "scripts/pack.ts"]);
  if (!existsSync(path.join(root, "package.json"))) await create(root, manifest);
  else await refreshLocalPackages(root, manifest);
  const pkg = readJson(path.join(root, "package.json"));
  for (const name of ["@legendapp/spark"]) {
    const overrides = pkg.overrides ?? pkg.resolutions ?? pkg.pnpm?.overrides ?? {};
    if (!overrides[name]) throw new Error(`Kitchen Sink needs the packed ${name} archive`);
    pkg.dependencies[name] = overrides[name];
  }
  pkg.dependencies["base64-js"] = "1.5.1";
  pkg.dependencies.uniwind = "1.6.3";
  pkg.dependencies.tailwindcss = "4.2.4";
  writeJson(path.join(root, "package.json"), pkg);
  await run(root, managerCommand(packageManager(root), ["install"]));
  writeJson(marker, { managed: true });
  // Copy only application source. Preserve the freshly created consumer's
  // identity, SDK archive dependencies, and generated native configuration.
  copyKitchenSinkScreens(source, root);
  return root;
}
export function copyKitchenSinkScreens(source: string, root: string) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isFile() && (/\.tsx?$/.test(entry.name) || ["global.css", "metro.config.js"].includes(entry.name))) cpSync(path.join(source, entry.name), path.join(root, entry.name));
  }
  cpSync(path.join(source, "../sidecar/client.ts"), path.join(root, "sidecar-client.ts"));
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(arg => arg !== "--packaged");
  if (args.includes("--help")) console.log("bun run kitchen-sink:prepare [fresh-directory]\nPack the SDK and prepare a separate copied consumer for integration tests.");
  else {
    if (args.length > 1 || args[0]?.startsWith("--")) throw new Error("Use bun run kitchen-sink:prepare [fresh-directory]. Everyday development runs directly from examples/kitchen-sink.");
    const root = path.resolve(args[0] ?? ".spark/examples/KitchenSinkPackaged");
    await prepareKitchenSink(root);
    console.log(`Packaged kitchen sink ready at ${root}`);
  }
}
