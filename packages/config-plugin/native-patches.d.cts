export function prepareNativePatches(root: string, installed?: { name: string; root: string; json: any }[]): Record<string, { root: string }>;
export function removeExpoApplicationAlias(reactNativeMacOSRoot: string, expoModulesCoreRoot: string): void;
export type AppPatch = { version?: string; file: string; thirdParty: boolean; error?: string; bytes: Buffer };
export function appPatches(root: string, app: any): Record<string, AppPatch>;
export type PatchLayer = { text: string; apply: boolean; error(relative: string): string } | undefined;
export function layerPatches(packageRoot: string, name: string, layers: PatchLayer[]): void;
export function withoutReceipt(manifest: string): string;
