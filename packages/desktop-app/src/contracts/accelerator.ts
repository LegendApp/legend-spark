import { SparkError } from "./index";
export type Accelerator = { key: string; modifiers: number };
// AppKit uses these bit positions in NSEventModifierFlags.
const modifiers: Record<string, number> = {
  cmd: 1 << 20, command: 1 << 20, meta: 1 << 20, commandorcontrol: 1 << 20, cmdorctrl: 1 << 20,
  ctrl: 1 << 18, control: 1 << 18, alt: 1 << 19, option: 1 << 19, shift: 1 << 17, fn: 1 << 23, capslock: 1 << 16,
};
const named: Record<string, string> = { enter: "\r", return: "\r", escape: "\u001b", esc: "\u001b", tab: "\t", space: " ", backspace: "\u007f", delete: "\uf728", up: "\uf700", down: "\uf701", left: "\uf702", right: "\uf703", plus: "+" };
const extended: Record<string, string> = { home: "\uf729", end: "\uf72b", pageup: "\uf72c", pagedown: "\uf72d", mediaplaypause: "MediaPlayPause", medianext: "MediaNext", mediaprevious: "MediaPrevious" };
export interface AcceleratorParseOptions { allowUnmodifiedCharacter?: boolean; allowExtendedKeys?: boolean }
export function parseAccelerator(value: string, platform: "macos" | "windows" = "macos", options: AcceleratorParseOptions = {}): Accelerator {
  if (typeof value !== "string" || !["macos", "windows"].includes(platform)) throw new SparkError("E_INVALID_ARGUMENT", "Expected accelerator and desktop platform");
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected accelerator parsing options");
  for (const key of Object.keys(options)) if (!["allowUnmodifiedCharacter", "allowExtendedKeys"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown accelerator option: ${key}`);
  if ([options.allowUnmodifiedCharacter, options.allowExtendedKeys].some(value => value !== undefined && typeof value !== "boolean")) throw new SparkError("E_INVALID_ARGUMENT", "Accelerator parsing flags must be boolean");
  const parts = value.toLowerCase().split("+").map(part => part.trim());
  let flags = 0;
  for (const part of parts.slice(0, -1)) {
    const flag = platform === "windows" && (part === "cmdorctrl" || part === "commandorcontrol") ? 1 << 18 : modifiers[part];
    if (!flag || (flags & flag)) throw new SparkError("E_INVALID_ARGUMENT", `Invalid or duplicate modifier: ${part}`);
    if ((part === "fn" || part === "capslock") && !options.allowExtendedKeys) throw new SparkError("E_UNSUPPORTED_OPTION", `Modifier unavailable on this shortcut surface: ${part}`);
    flags |= flag;
  }
  const last = parts.at(-1)!;
  if (extended[last] && !options.allowExtendedKeys) throw new SparkError("E_UNSUPPORTED_OPTION", `Key unavailable on this shortcut surface: ${last}`);
  let key = named[last] ?? extended[last] ?? last;
  if (/^f([1-9]|1[0-9]|20)$/.test(last)) key = String.fromCharCode(0xf704 + Number(last.slice(1)) - 1);
  if ((!extended[last] && key.length !== 1) || /[\ud800-\udfff]/.test(key)) throw new SparkError("E_INVALID_ARGUMENT", `Unknown shortcut key: ${last}`);
  if (!options.allowUnmodifiedCharacter && !flags && !named[last] && !extended[last] && !/^f([1-9]|1[0-9]|20)$/.test(last)) throw new SparkError("E_INVALID_ARGUMENT", "Character shortcuts need a modifier");
  return { key, modifiers: flags };
}

/** Canonical spelling for a parsed binding; this does not encode physical key codes. */
export function formatAccelerator(value: Accelerator): string {
  const labels = [[1 << 20, "Cmd"], [1 << 18, "Ctrl"], [1 << 19, "Alt"], [1 << 17, "Shift"], [1 << 23, "Fn"], [1 << 16, "CapsLock"]] as const;
  const keys: Record<string, string> = { "\r": "Enter", "\u001b": "Escape", "\t": "Tab", " ": "Space", "\u007f": "Backspace", "\uf728": "Delete", "\uf700": "Up", "\uf701": "Down", "\uf702": "Left", "\uf703": "Right", "+": "Plus", "\uf729": "Home", "\uf72b": "End", "\uf72c": "PageUp", "\uf72d": "PageDown" };
  const code = value.key.charCodeAt(0);
  const key = keys[value.key] ?? (value.key.length === 1 && code >= 0xf704 && code <= 0xf717 ? `F${code - 0xf704 + 1}` : value.key.length === 1 ? value.key.toUpperCase() : value.key);
  return [...labels.filter(([flag]) => value.modifiers & flag).map(([, label]) => label), key].join("+");
}
