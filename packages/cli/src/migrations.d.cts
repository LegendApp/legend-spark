export const pointer: string;
export const claudePointer: string;
export function mergePointer(source: string): string;
export function refreshPointers(root: string): void;
export const migrations: { version: string; automatic: boolean; apply(root: string): void }[];
export function installedSparkVersion(root: string): string;
export function migrateProject(root: string, version: string, automatic?: boolean): string[];
