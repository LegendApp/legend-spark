export function prepareNativePatches(root: string, installed?: { name: string; root: string; json: any }[]): Record<string, { root: string }>;
export function removeExpoApplicationAlias(reactNativeMacOSRoot: string, expoModulesCoreRoot: string): void;
export type AppPatch = { version?: string; file: string; thirdParty: boolean; error?: string; bytes: Buffer };
export function appPatches(root: string, app: any): Record<string, AppPatch>;
export type PatchLayer = { text: string; applied?: string; apply: boolean; error(relative: string): string } | undefined;
export function layerPatches(packageRoot: string, name: string, layers: PatchLayer[], options?: { dryRun?: boolean }): void;
export function resolveManifest(req: NodeJS.Require, name: string): string;
export function withoutReceipt(manifest: string): string;
export function appPatchIssues(root: string): string[];
