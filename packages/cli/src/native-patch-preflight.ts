import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findFramework } from "./local.ts";
import { installedPackages, readJson, VERSION, type NativePackage } from "./project.ts";

type PatchRecord = { version: string; patchHash: string; upstreamIntegrity?: string; upstreamRevision?: string };
export type PackedPatchRequirements = { schema: 1; frameworkVersion: string; packages: Record<string, PatchRecord> };

const required = ["@react-native-runtimes/core", "react-native-nitro-modules", "@op-engineering/op-sqlite", "react-native-webview"];

export function validatePackedNativePatches(packages: Pick<NativePackage, "name" | "json">[], requirements: PackedPatchRequirements | undefined, frameworkVersion = VERSION): string[] {
  if (!requirements || requirements.schema !== 1 || requirements.frameworkVersion !== frameworkVersion || !requirements.packages || typeof requirements.packages !== "object")
    return [`The installed @legendapp/spark SDK does not include native patch provenance for ${frameworkVersion}. Run spark add desktop to install the matching SDK packages, then retry.`];
  const installed = new Map(packages.map(pkg => [pkg.name, pkg.json]));
  const errors: string[] = [];
  for (const name of required) if (!installed.has(name)) errors.push(`${name} is missing; reinstall the dependencies from this Spark SDK.`);
  for (const name of required) {
    const actual = installed.get(name);
    if (!actual) continue;
    const expected = requirements.packages[name];
    const spark = actual.spark;
    if (!expected || typeof expected.version !== "string" || !/^[a-f0-9]{64}$/.test(expected.patchHash) ||
        (!expected.upstreamIntegrity && !expected.upstreamRevision) || actual.version !== expected.version || spark?.sdk !== true || spark.patchHash !== expected.patchHash ||
        spark.upstreamIntegrity !== expected.upstreamIntegrity || spark.upstreamRevision !== expected.upstreamRevision) {
      errors.push(`${name}@${actual.version} is not the matching patched Spark SDK package.`);
    }
  }
  return errors;
}

export function validateWorkspaceNativePatches(root: string, packages: Pick<NativePackage, "name" | "root" | "json">[]): string[] {
  const framework = findFramework(root);
  if (!framework) return ["The Spark SDK is missing native patch provenance. Run spark add desktop to install matching SDK packages, then retry."];
  const frameworkPackage = readJson(path.join(framework, "package.json"));
  const map = frameworkPackage.sparkWorkspacePatches as Record<string, string> | undefined;
  if (!map) return ["The Spark workspace has no install-time patch inventory. Run npm run postinstall in the framework checkout, then retry."];
  const pins = readJson(path.join(framework, "patches/workspace/upstream.json")) as Record<string, { version: string; integrity?: string; revision?: string }>;
  const installed = new Map(packages.map(pkg => [pkg.name, pkg]));
  const errors: string[] = [];
  for (const name of required) {
    const pkg = installed.get(name);
    if (!pkg) {
      errors.push(`${name} is missing; reinstall the dependencies from this Spark workspace.`);
      continue;
    }
    const entry = Object.entries(map).find(([key]) => key.slice(0, key.lastIndexOf("@")) === name);
    const pin = pins[name];
    if (!entry || !pin || !entry[0].endsWith(`@${pin.version}`) || pkg.json.version !== pin.version) {
      errors.push(`${name}@${pkg.json.version} does not match the Spark workspace patch inventory.`);
      continue;
    }
    const patchFile = path.resolve(framework, entry[1]);
    if (!patchFile.startsWith(framework + path.sep) || !existsSync(patchFile)) {
      errors.push(`${name} has no readable Spark workspace patch. Run npm run postinstall in the framework checkout.`);
      continue;
    }
    const patchHash = createHash("sha256").update(readFileSync(patchFile)).digest("hex");
    const receipt = pkg.json.spark?.workspacePatch;
    const expectedRevision = pin.revision;
    if (!receipt || receipt.schema !== 1 || receipt.version !== pin.version || receipt.patchHash !== patchHash ||
        receipt.upstreamIntegrity !== pin.integrity || (expectedRevision && receipt.upstreamRevision !== expectedRevision)) {
      errors.push(`${name}@${pkg.json.version} has no matching applied workspace patch stamp. Run npm run postinstall in the framework checkout, then retry.`);
    }
  }
  return errors;
}

export function assertNativePatchPreflight(root: string) {
  const packages = installedPackages(root);
  const framework = findFramework(root);
  let errors: string[];
  const spark = packages.find(pkg => pkg.name === "@legendapp/spark");
  const requirements = spark?.json.spark?.nativePatchRequirements as PackedPatchRequirements | undefined;
  if (requirements) errors = validatePackedNativePatches(packages, requirements);
  else if (framework) errors = validateWorkspaceNativePatches(root, packages);
  else {
    errors = validatePackedNativePatches(packages, requirements);
  }
  if (errors.length) throw new Error(`Native preparation stopped before changing project files:\n${errors.map(error => `- ${error}`).join("\n")}`);
}
