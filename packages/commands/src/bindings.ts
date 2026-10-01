import { Platform } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { parseAccelerator, formatAccelerator } from "@legendapp/spark-desktop-app/src/contracts/accelerator";
import type { KeyboardEvent } from "@legendapp/spark-desktop-shortcuts/src/keyboard-manager";
export type HotkeyValue = string;
export type HotkeyDefinition<Id extends string = string> = { id: Id; title: string; description?: string; defaultBindings: readonly HotkeyValue[]; repeat?: boolean; allowExtraModifiers?: boolean };
export type HotkeyBindingState<Id extends string = string> = Record<Id, readonly HotkeyValue[]>;
export const hotkeyFileVersion = 1;
export type HotkeyFile<Id extends string = string> = { version: typeof hotkeyFileVersion; bindings: HotkeyBindingState<Id> };
export interface HotkeyBindingLimitOptions { maxBindingsPerCommand?: number }
const platform = () => Platform.OS === "windows" ? "windows" : "macos";
export function parseBinding(value: string) { return parseAccelerator(value, platform(), { allowUnmodifiedCharacter: true, allowExtendedKeys: true }); }
export function normalizeBinding(value: string): string {
  let canonical = formatAccelerator(parseBinding(value));
  if (typeof value === "string" && value.toLowerCase().split("+").some(token => ["cmdorctrl", "commandorcontrol"].includes(token.trim()))) canonical = canonical.replace(platform() === "windows" ? "Ctrl" : "Cmd", "CmdOrCtrl");
  return canonical;
}
export function normalizeHotkeyBindings(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values)) throw new SparkError("E_INVALID_ARGUMENT", "Hotkey bindings must be an array of accelerators");
  return [...new Set(values.map(normalizeBinding))];
}
export function getDefaultHotkeyBindings<Id extends string>(definition: HotkeyDefinition<Id>): readonly string[] { return normalizeHotkeyBindings(definition.defaultBindings); }
export function limitHotkeyBindings(bindings: readonly string[], limit?: number): readonly string[] {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) throw new SparkError("E_INVALID_ARGUMENT", "maxBindingsPerCommand must be a nonnegative integer");
  return limit === undefined ? bindings : bindings.slice(0, limit);
}
export function validateDefinitions<Id extends string>(definitions: readonly HotkeyDefinition<Id>[]): void {
  if (!Array.isArray(definitions)) throw new SparkError("E_INVALID_ARGUMENT", "Expected command definitions");
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (!definition || typeof definition.id !== "string" || !definition.id || ids.has(definition.id) || typeof definition.title !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Command IDs must be unique nonempty strings with titles");
    ids.add(definition.id);
    for (const flag of [definition.repeat, definition.allowExtraModifiers]) if (flag !== undefined && typeof flag !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Command flags must be boolean");
    normalizeHotkeyBindings(definition.defaultBindings);
  }
}
export function normalizeHotkeyFile<Id extends string>(value: unknown, definitions: readonly HotkeyDefinition<Id>[], { maxBindingsPerCommand }: HotkeyBindingLimitOptions = {}): HotkeyFile<Id> {
  validateDefinitions(definitions); limitHotkeyBindings([], maxBindingsPerCommand);
  let persisted: Record<string, unknown> = {};
  if (value !== undefined) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_DATA", "Expected a versioned hotkey file");
    const file = value as Record<string, unknown>;
    if (file.version !== hotkeyFileVersion || !file.bindings || typeof file.bindings !== "object" || Array.isArray(file.bindings)) throw new SparkError("E_INVALID_DATA", "Expected version 1 and a bindings object");
    persisted = file.bindings as Record<string, unknown>;
  }
  const bindings = Object.fromEntries(definitions.map(definition => {
    const stored = Object.hasOwn(persisted, definition.id) ? persisted[definition.id] : undefined;
    let values: readonly string[];
    try { values = normalizeHotkeyBindings(stored === undefined ? definition.defaultBindings : stored as readonly string[]); }
    catch (cause) { throw new SparkError("E_INVALID_DATA", `Invalid bindings for ${definition.id}`, { cause }); }
    return [definition.id, limitHotkeyBindings(values, maxBindingsPerCommand)];
  })) as HotkeyBindingState<Id>;
  return { version: hotkeyFileVersion, bindings };
}
export function serializeHotkeyFile<Id extends string>(value: HotkeyFile<Id>, definitions: readonly HotkeyDefinition<Id>[], options?: HotkeyBindingLimitOptions): HotkeyFile<Id> { return normalizeHotkeyFile(value, definitions, options); }
export function hotkeyBindingListsEqual(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => normalizeBinding(value) === normalizeBinding(right[index])); }
export function bindingKey(value: string): string { return formatAccelerator(parseBinding(value)); }
export function getHotkeyBindingConflicts<Id extends string>(definitions: readonly HotkeyDefinition<Id>[], values: HotkeyBindingState<Id>): Map<string, Id[]> {
  const commands = new Map<string, Id[]>();
  for (const definition of definitions) for (const binding of Object.hasOwn(values, definition.id) ? values[definition.id] : definition.defaultBindings) {
    const key = bindingKey(binding), ids = commands.get(key) ?? [];
    if (!ids.includes(definition.id)) ids.push(definition.id);
    commands.set(key, ids);
  }
  return new Map([...commands].filter(([, ids]) => ids.length > 1));
}
const modifierMask = (1 << 20) | (1 << 18) | (1 << 19) | (1 << 17) | (1 << 23) | (1 << 16);
export interface HotkeyMatchOptions { allowExtraModifiers?: boolean }
export function matchesHotkey(event: KeyboardEvent, value: string, { allowExtraModifiers = false }: HotkeyMatchOptions = {}): boolean {
  return matchesParsedHotkey(event, parseBinding(value), allowExtraModifiers);
}
/** Registration-time parsing keeps accelerator parsing out of keyboard dispatch. */
export function matchesParsedHotkey(event: KeyboardEvent, binding: ReturnType<typeof parseBinding>, allowExtraModifiers = false): boolean {
  let active = event.modifiers & modifierMask;
  // AppKit adds Fn for navigation/function keys; Caps Lock does not change a command.
  if (!(binding.modifiers & (1 << 23)) && /^[\uf700-\uf747]$/.test(event.key)) active &= ~(1 << 23);
  if (!(binding.modifiers & (1 << 16))) active &= ~(1 << 16);
  return event.key.toLowerCase() === binding.key.toLowerCase() && (allowExtraModifiers ? (active & binding.modifiers) === binding.modifiers : active === binding.modifiers);
}
export function bindingFromEvent(event: KeyboardEvent): string | null {
  let modifiers = event.modifiers & modifierMask & ~(1 << 16);
  if (/^[\uf700-\uf747]$/.test(event.key)) modifiers &= ~(1 << 23);
  try { return normalizeBinding(formatAccelerator({ key: event.key, modifiers })); } catch { return null; }
}
export function formatHotkey(value: string | null | undefined, placeholder = ""): string {
  if (value == null) return placeholder;
  const canonical = normalizeBinding(value);
  if (Platform.OS !== "macos") return canonical.replaceAll("CmdOrCtrl", "Ctrl").replaceAll("Cmd", "Win").split("+").join(" + ");
  return canonical.split("+").map(part => ({ Cmd: "⌘", CmdOrCtrl: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Enter: "↩", Escape: "Esc", Backspace: "⌫", Delete: "⌦", Left: "←", Right: "→", Up: "↑", Down: "↓" })[part] ?? part).join(" + ");
}
