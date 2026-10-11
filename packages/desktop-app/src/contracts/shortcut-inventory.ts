import type { Accelerator } from "./accelerator";

/** Where a live key binding was registered. Internal: shortcut surfaces publish here so conflicts can name their owner. */
export type ShortcutInventoryOwner =
  | { source: "shortcut"; windowId?: string }
  | { source: "global-shortcut" }
  | { source: "menu"; menuId: string; itemId: string };
export interface ShortcutInventoryEntry { accelerator: Accelerator; owner: ShortcutInventoryOwner }

const entries = new Map<object, readonly ShortcutInventoryEntry[]>(), listeners = new Set<() => void>();
let version = 0;

/** Replaces (or with an empty list removes) the entries a registration token owns. */
export function setShortcutInventory(token: object, value: readonly ShortcutInventoryEntry[]): void {
  if (!value.length && !entries.has(token)) return;
  if (value.length) entries.set(token, value); else entries.delete(token);
  version++;
  for (const listener of [...listeners]) {
    try { listener(); } catch (cause) { console.error(cause); }
  }
}
export function getShortcutInventory(exclude?: ReadonlySet<object>): ShortcutInventoryEntry[] {
  return [...entries].flatMap(([token, value]) => exclude?.has(token) ? [] : value);
}
/** Increments on every change, so readers can cache derived results without observing. */
export function getShortcutInventoryVersion(): number { return version; }
export function observeShortcutInventory(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
