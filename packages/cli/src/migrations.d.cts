export const pointer: string;
export const claudePointer: string;
export function mergePointer(source: string): string;
export function refreshPointers(root: string): void;
import type { FileChange, ManualStep, MigrationContext } from './migration-helpers.cjs';
export interface Migration { version: string; automatic: boolean; breaking?: boolean; apply(context: MigrationContext): void }
export interface MigrationPlan { previous?: string; version: string; versions: string[]; changes: FileChange[]; manualSteps: ManualStep[] }
export interface MigrationOptions { automatic?: boolean; fromVersion?: string }
export const migrations: Migration[];
export function installedSparkVersion(root: string): string;
export function planMigrations(root: string, version: string, options?: MigrationOptions): MigrationPlan;
export function applyMigrationPlan(root: string, plan: MigrationPlan, recordVersion?: boolean): void;
/** Upgrade calls this only after installation and initialization succeed. */
export function recordProjectVersion(root: string, version: string): void;
export function printMigrationPlan(plan: MigrationPlan): void;
export function migrateProject(root: string, version: string, automatic?: boolean, options?: Pick<MigrationOptions, 'fromVersion'>): string[];
