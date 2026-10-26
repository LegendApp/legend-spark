export function prepareNativePatches(root: string, installed?: { name: string; root: string; json: any }[]): Record<string, { root: string }>;
export function removeExpoApplicationAlias(reactNativeMacOSRoot: string, expoModulesCoreRoot: string): void;
