export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export interface FileChange { file: string; before: string | null; after: string | null }
export interface ManualStep { version: string; message: string; notes: string }
export interface MigrationContext {
  readFile(file: string): string | null;
  writeFile(file: string, content: string): void;
  editJson<T extends object = JsonObject>(file: string, edit: (value: T) => void): void;
  renameFile(from: string, to: string): void;
  updateTemplate(file: string, previous: string, next: string): void;
  replaceImport(from: string, to: string, names?: Readonly<Record<string, string>>): void;
  manualStep(message: string): void;
}
export const upgradeNotesPath: string;
export function createMigrationContext(root: string, version: string, changes: Map<string, FileChange>, manualSteps: ManualStep[]): MigrationContext;
export function resolveDependency(root: string, request: string): string;
