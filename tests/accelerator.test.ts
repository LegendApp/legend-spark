import { expect, test } from "vitest";
import { parseAccelerator } from "../packages/desktop-app/src/contracts/accelerator.ts";
test("macOS modifier aliases normalize to native flags", () => {
  expect(parseAccelerator("CommandOrControl+Shift+K")).toEqual({ key: "k", modifiers: (1 << 20) | (1 << 17) });
  expect(parseAccelerator("ctrl+option+X")).toEqual({ key: "x", modifiers: (1 << 18) | (1 << 19) });
  expect(parseAccelerator("Cmd+Plus").key).toBe("+");
});
test("named keys and function keys map to AppKit characters", () => {
  expect(parseAccelerator("Escape").key).toBe("\u001b"); expect(parseAccelerator("Enter").key).toBe("\r");
  expect(parseAccelerator("Alt+Left").key).toBe("\uf702"); expect(parseAccelerator("F1").key).toBe("\uf704");
  expect(parseAccelerator("F20").key).toBe(String.fromCharCode(0xf704 + 19));
});
test("unknown, duplicate and unsafe bare-character accelerators fail", () => {
  for (const value of ["", "Command+", "Command+Command+K", "Command+Meta+K", "Magic+K", "F21", "hello", "K", "f", "Command++"]) expect(() => parseAccelerator(value)).toThrow();
});


test("global shortcuts map CommandOrControl to Control on Windows", async () => {
  const { parseAccelerator: parse } = await import("../packages/desktop-app/src/contracts/accelerator.ts");
  expect(parse("CommandOrControl+Shift+K", "windows")).toEqual({ key: "k", modifiers: (1 << 18) | (1 << 17) });
  expect(parse("Meta+K", "windows").modifiers).toBe(1 << 20);
  expect(parse("CommandOrControl+K", "macos").modifiers).toBe(1 << 20);
  expect(() => parse("CommandOrControl+Control+K", "windows")).toThrow("duplicate");
});
