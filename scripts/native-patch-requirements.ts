import { audioPatchHash } from "./prepare-audio.ts";
import { runtimesPatchHash, runtimesRevision } from "./prepare-runtimes.ts";
import { windowsPatchHash } from "./prepare-windows-libraries.ts";
import { readJson } from "../packages/cli/src/project.ts";
import path from "node:path";

export function assertRuntimesRevision(workspaceRevision: string) {
  if (workspaceRevision !== runtimesRevision) {
    throw new Error("Workspace Runtimes pin does not match the revision used by the native patch builder.");
  }
}

/** Exact patch recipe metadata embedded in the public SDK manifest for consumers. */
export function nativePatchRequirements(root: string, frameworkVersion: string) {
  const workspace = readJson(path.join(root, "patches/workspace/upstream.json")) as Record<string, { version: string; integrity: string; revision?: string }>;
  const windows = readJson(path.join(root, "patches/windows/upstream.json")) as Record<string, { version: string; integrity: string }>;
  assertRuntimesRevision(workspace["@react-native-runtimes/core"].revision ?? "");
  const packages = {
    "@react-native-runtimes/core": {
      version: workspace["@react-native-runtimes/core"].version,
      patchHash: runtimesPatchHash(root),
      upstreamRevision: runtimesRevision,
    },
    "react-native-nitro-modules": {
      version: windows["react-native-nitro-modules"].version,
      patchHash: windowsPatchHash("react-native-nitro-modules", windows["react-native-nitro-modules"], root),
      upstreamIntegrity: windows["react-native-nitro-modules"].integrity,
    },
    "@op-engineering/op-sqlite": {
      version: windows["@op-engineering/op-sqlite"].version,
      patchHash: windowsPatchHash("@op-engineering/op-sqlite", windows["@op-engineering/op-sqlite"], root),
      upstreamIntegrity: windows["@op-engineering/op-sqlite"].integrity,
    },
    "react-native-webview": {
      version: windows["react-native-webview"].version,
      patchHash: windowsPatchHash("react-native-webview", windows["react-native-webview"], root),
      upstreamIntegrity: windows["react-native-webview"].integrity,
    },
    "expo-audio": {
      version: workspace["expo-audio"].version,
      patchHash: audioPatchHash(root),
      upstreamIntegrity: workspace["expo-audio"].integrity,
    },
  };
  return { schema: 1 as const, frameworkVersion, packages };
}
