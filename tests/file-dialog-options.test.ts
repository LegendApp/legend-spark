import { expect, test } from "vitest";
import { dialogOptions } from "../packages/file-dialog/src/options.ts";
test("file picker has portable selection with a scoped macOS mixed-selection extension", () => {
  expect(dialogOptions({ macos: { mixedSelection: true } }, "open", "macos")).toMatchObject({ canChooseFiles: true, canChooseDirectories: true });
  expect(dialogOptions({ macos: { mixedSelection: true } }, "open", "windows")).toMatchObject({ canChooseFiles: true, canChooseDirectories: false });
  expect(dialogOptions({ selection: "directories" }, "open", "windows")).toMatchObject({ canChooseFiles: false, canChooseDirectories: true });
  expect(() => dialogOptions({ selection: "mixed" as never }, "open", "macos")).toThrow();
});
test("open/save share defaultPath and filter semantics and reject ignored options", () => {
  for (const kind of ["open", "save"] as const) {
    expect(dialogOptions({ defaultPath: "C:\\Users", filters: [{ name: "Text", extensions: ["txt"] }] }, kind, "windows")).toMatchObject({ allowedFileTypes: ["txt"], filters: [{ name: "Text", extensions: ["txt"] }] });
    expect(dialogOptions({ filters: [{ extensions: ["txt"] }] }, kind, "windows")).toMatchObject({ filters: [{ extensions: ["txt"] }] });
    for (const extensions of [["text/plain"], ["txt;*"], [".txt"], []]) expect(() => dialogOptions({ filters: [{ name: "Files", extensions }] }, kind, "windows")).toThrow();
    for (const name of ["", "  ", "Files\0"]) expect(() => dialogOptions({ filters: [{ name, extensions: ["txt"] }] }, kind, "windows")).toThrow();
    expect(() => dialogOptions({ filters: [{ name: "Files", extensions: ["txt"], extra: true } as never] }, kind, "windows")).toThrow();
    expect(() => dialogOptions({ defaultPath: "relative" }, kind, "macos")).toThrow();
    expect(() => dialogOptions({ directory: "/Users" } as never, kind, "macos")).toThrow("Unsupported dialog option");
    expect(dialogOptions({ windowId: "editor" }, kind, "macos")).toMatchObject({ windowId: "editor" });
    for (const windowId of ["", "bad.id", "x".repeat(101)]) expect(() => dialogOptions({ windowId }, kind, "macos")).toThrow("owner");
  }
});
test("save defaultPath forwards a file-naming path for native splitting", () => {
  // Bridges stat the last component: a live directory starts the panel; anything
  // else names the suggested file, whose parent starts the panel. An explicit
  // defaultName wins over the suggestion.
  expect(dialogOptions({ defaultPath: "/tmp/notes/draft.md" }, "save", "macos")).toMatchObject({ directory: "/tmp/notes/draft.md" });
  expect(dialogOptions({ defaultPath: "C:\\Users" }, "save", "windows")).toMatchObject({ directory: "C:\\Users" });
  expect(() => dialogOptions({ defaultPath: "relative" }, "save", "macos")).toThrow();
  // Open dialogs treat defaultPath as the starting directory unchanged.
  expect(dialogOptions({ defaultPath: "/tmp/notes/draft.md" }, "open", "macos")).toMatchObject({ directoryURL: "/tmp/notes/draft.md" });
});
