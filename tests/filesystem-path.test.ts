import { test, expect } from "vitest";
import { absolutePath } from "../packages/file-system/src/path.ts";

test("filesystem accepts drive-qualified, UNC and file URL paths on Windows", () => {
  for (const value of ["C:\\Users\\Test\\file.txt", "D:/space ü/file", "\\\\server\\share\\file", "\\\\?\\C:\\long\\file", "file:///C:/space%20name/file"]) expect(absolutePath(value, "windows")).toBe(value);
  for (const value of ["C:relative", "relative", "\\rooted", "/rooted", "\\\\server", "C:\\bad\0name"]) expect(() => absolutePath(value, "windows")).toThrow("absolute");
});
test("filesystem keeps macOS path rules", () => {
  for (const value of ["/tmp/space ü", "file:///tmp/test"]) expect(absolutePath(value, "macos")).toBe(value);
  for (const value of ["C:\\file", "relative", "/tmp/\0file"]) expect(() => absolutePath(value, "macos")).toThrow("absolute");
});

import { settingsFilename as windowsFilename } from "../packages/settings/src/filename.windows.ts";
import { settingsFilename as macFilename } from "../packages/settings/src/filename.ts";
test("Windows settings names escape device names without collisions or changing macOS storage", () => {
  expect(windowsFilename("CON")).toBe("%43ON.json");
  expect(windowsFilename("nul.custom")).toBe("%6Eul.custom.json");
  expect(windowsFilename("%43ON")).toBe("%2543ON.json");
  expect(windowsFilename("counter")).toBe("counter.json");
  expect(macFilename("CON")).toBe("CON.json");
});

import { nativePath } from "../packages/desktop-app/src/contracts/path";
test("local file URLs decode once and cannot hide foreign hosts or invalid paths", () => {
  expect(nativePath("file:///tmp/space%20name%2520", "macos")).toBe("/tmp/space name%20");
  expect(nativePath("file:///C:/space%20name/file", "windows")).toBe("C:\\space name\\file");
  for (const input of ["file://server/share", "file:///tmp/x?query", "file:///tmp/x#fragment", "file:///tmp/%00", "file:///tmp/%ZZ"]) expect(() => nativePath(input, "macos")).toThrow();
});
