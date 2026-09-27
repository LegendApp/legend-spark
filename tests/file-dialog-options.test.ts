import { expect, test } from "vitest";
import { dialogOptions } from "../packages/file-dialog/src/options.ts";
test("file picker has portable selection with a scoped macOS mixed-selection extension", () => {
  expect(dialogOptions({ macos: { mixedSelection: true } }, "open", "macos")).toMatchObject({ canChooseFiles: true, canChooseDirectories: true });
  expect(dialogOptions({ macos: { mixedSelection: true } }, "open", "windows")).toMatchObject({ canChooseFiles: true, canChooseDirectories: false });
  expect(dialogOptions({ selection: "directories" }, "open", "windows")).toMatchObject({ canChooseFiles: false, canChooseDirectories: true });
  expect(() => dialogOptions({ selection: "mixed" as never }, "open", "macos")).toThrow();
});
test("open/save share extension and directory semantics and reject ignored options", () => {
  for (const kind of ["open", "save"] as const) {
    expect(dialogOptions({ directory: "C:\\Users", filters: [{ extensions: ["txt"] }] }, kind, "windows")).toMatchObject({ allowedFileTypes: ["txt"] });
    for (const extensions of [["text/plain"], ["txt;*"], [".txt"], []]) expect(() => dialogOptions({ filters: [{ extensions }] }, kind, "windows")).toThrow();
    expect(() => dialogOptions({ directory: "relative" }, kind, "macos")).toThrow();
    expect(() => dialogOptions({ windowId: "ignored" } as never, kind, "macos")).toThrow("Unsupported");
  }
});
