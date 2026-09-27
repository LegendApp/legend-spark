import { SparkError } from "./index";
export type Accelerator = { key: string; modifiers: number };
// AppKit uses these bit positions in NSEventModifierFlags.
const modifiers: Record<string, number> = {
  cmd: 1 << 20, command: 1 << 20, meta: 1 << 20, commandorcontrol: 1 << 20, cmdorctrl: 1 << 20,
  ctrl: 1 << 18, control: 1 << 18, alt: 1 << 19, option: 1 << 19, shift: 1 << 17,
};
const named: Record<string, string> = { enter: "\r", return: "\r", escape: "\u001b", esc: "\u001b", tab: "\t", space: " ", backspace: "\u007f", delete: "\uf728", up: "\uf700", down: "\uf701", left: "\uf702", right: "\uf703", plus: "+" };
export function parseAccelerator(value: string, platform: "macos" | "windows" = "macos"): Accelerator {
  if (typeof value !== "string" || !["macos", "windows"].includes(platform)) throw new SparkError("E_INVALID_ARGUMENT", "Expected accelerator and desktop platform");
  const parts = value.toLowerCase().split("+").map(part => part.trim());
  let flags = 0;
  for (const part of parts.slice(0, -1)) {
    const flag = platform === "windows" && (part === "cmdorctrl" || part === "commandorcontrol") ? 1 << 18 : modifiers[part];
    if (!flag || (flags & flag)) throw new SparkError("E_INVALID_ARGUMENT", `Invalid or duplicate modifier: ${part}`);
    flags |= flag;
  }
  const last = parts.at(-1)!;
  let key = named[last] ?? last;
  if (/^f([1-9]|1[0-9]|20)$/.test(last)) key = String.fromCharCode(0xf704 + Number(last.slice(1)) - 1);
  if (key.length !== 1 || /[\ud800-\udfff]/.test(key)) throw new SparkError("E_INVALID_ARGUMENT", `Unknown shortcut key: ${last}`);
  if (!flags && !named[last] && !/^f([1-9]|1[0-9]|20)$/.test(last)) throw new SparkError("E_INVALID_ARGUMENT", "Character shortcuts need a modifier");
  return { key, modifiers: flags };
}
