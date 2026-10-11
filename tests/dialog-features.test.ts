import { beforeEach, expect, test, vi } from "vitest";
// Accessory controls, the suppression checkbox, text prompts and the About panel, against a mocked bridge.
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
const platform = { OS: "macos" };
const native = (method: string, args: string) => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(reply(method, JSON.parse(args)))); };
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: (name: string) => name === "NativeFileDialog" ? { open: (args: string) => native("open", args), save: (args: string) => native("save", args) } : { call: native } } }));
const files = await import("../packages/file-dialog/src/index.ts");
const messages = await import("../packages/message-dialog/src/index.ts");
beforeEach(() => { platform.OS = "macos"; calls.length = 0; reply = () => null; });

const accessory = [
  { type: "popup", id: "format", label: "Format:", options: [{ value: "txt", label: "Plain text" }, { value: "md", label: "Markdown" }] },
  { type: "checkbox", id: "metadata", label: "Include metadata" },
] as const;

test("accessory controls reach the bridge normalized and their values return with the selection", async () => {
  reply = (_, args) => ({ path: "/tmp/notes.md", accessory: { format: args.accessory[0].options[1].value, metadata: true } });
  expect(await files.saveFileDialog({ defaultName: "notes", accessory })).toEqual({ canceled: false, path: "/tmp/notes.md", accessory: { format: "md", metadata: true } });
  expect(calls[0]!.args.accessory).toEqual([{ ...accessory[0], value: "txt" }, { ...accessory[1], checked: false }]);
  reply = () => ({ paths: ["/tmp/a.txt"], accessory: { metadata: false, format: "txt" } });
  const opened = await files.openFileDialog({ accessory });
  expect(opened).toEqual({ canceled: false, paths: ["/tmp/a.txt"], accessory: { format: "txt", metadata: false } });
  expect(Object.keys(!opened.canceled && opened.accessory || {})).toEqual(["format", "metadata"]);
  reply = () => null;
  expect(await files.openFileDialog({ accessory })).toEqual({ canceled: true });
  reply = () => ["/tmp/a.txt"];
  expect(await files.openFileDialog()).toEqual({ canceled: false, paths: ["/tmp/a.txt"] });
});

test("accessory results that do not match the requested controls are malformed", async () => {
  for (const value of [["/tmp/a.txt"], { paths: ["/tmp/a.txt"] }, { paths: ["/tmp/a.txt"], accessory: { format: "rtf", metadata: true } }, { paths: ["/tmp/a.txt"], accessory: { format: "md", metadata: "yes" } }, { paths: ["/tmp/a.txt"], accessory: { format: "md", metadata: true, extra: 1 } }, { paths: [], accessory: { format: "md", metadata: true } }]) {
    reply = () => value;
    await expect(files.openFileDialog({ accessory })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
});

test("accessory controls are validated before any native call", async () => {
  const invalid: unknown[] = [
    [], Array.from({ length: 9 }, (_, index) => ({ type: "checkbox", id: `c${index}`, label: "C" })),
    [{ type: "slider", id: "x", label: "X" }], [{ type: "checkbox", id: "bad id", label: "X" }], [{ type: "checkbox", id: "x", label: "" }],
    [{ type: "checkbox", id: "x", label: "X", checked: "yes" }], [{ type: "checkbox", id: "x", label: "X" }, { type: "checkbox", id: "x", label: "Y" }],
    [{ type: "popup", id: "x", label: "X", options: [] }], [{ type: "popup", id: "x", label: "X", options: [{ value: "a", label: "A" }], value: "b" }],
    [{ type: "popup", id: "x", label: "X", options: [{ value: "a", label: "A" }, { value: "a", label: "B" }] }],
    [{ type: "popup", id: "x", label: "X", options: [{ value: "a", label: "A" }, { value: "b", label: "A" }] }],
  ];
  for (const controls of invalid) await expect(files.saveFileDialog({ accessory: controls as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(files.saveFileDialog({ accessory: [{ type: "checkbox", id: "x", label: "X", tooltip: "t" }] as never })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toHaveLength(0);
});

test("availability is reported per feature and unsupported Windows features reject typed", async () => {
  expect(files.getFileDialogAvailability("accessory")).toEqual({ available: true });
  for (const feature of ["checkbox", "prompt", "aboutPanel"] as const) expect(messages.getMessageDialogAvailability(feature)).toEqual({ available: true });
  expect(() => files.getFileDialogAvailability("preview" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => messages.getMessageDialogAvailability("toast" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  platform.OS = "windows";
  expect(files.getFileDialogAvailability()).toEqual({ available: true });
  expect(files.getFileDialogAvailability("accessory")).toEqual({ available: false, reason: "unsupported-platform" });
  expect(messages.getMessageDialogAvailability("checkbox")).toEqual({ available: true });
  expect(messages.getMessageDialogAvailability("prompt")).toEqual({ available: false, reason: "unsupported-platform" });
  expect(messages.getMessageDialogAvailability("aboutPanel")).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(files.openFileDialog({ accessory })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(messages.showPrompt({ title: "Name" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(messages.showAboutPanel()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  expect(calls).toHaveLength(0);
  platform.OS = "ios";
  expect(files.getFileDialogAvailability("accessory")).toEqual({ available: false, reason: "unsupported-platform" });
  expect(messages.getMessageDialogAvailability("prompt")).toEqual({ available: false, reason: "unsupported-platform" });
});

test("the suppression checkbox state returns with the selected button", async () => {
  reply = (_, args) => ({ button: 1, checked: !args.checkbox.checked });
  expect(await messages.showMessage({ title: "Empty the Trash?", buttons: [{ id: "cancel", label: "Cancel" }, { id: "empty", label: "Empty Trash" }], checkbox: { label: "Don't ask again" } })).toEqual({ buttonId: "empty", checked: true });
  expect(calls[0]).toMatchObject({ method: "show", args: { checkbox: { label: "Don't ask again" }, buttons: ["Cancel", "Empty Trash"] } });
  for (const checkbox of [{ label: "" }, { label: "X", checked: 1 }, { label: "X", extra: true }]) await expect(messages.showMessage({ title: "T", checkbox: checkbox as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("prompts return the confirmed value or a distinct cancellation", async () => {
  reply = () => ({ button: 0, checked: false, value: "Draft" });
  expect(await messages.showPrompt({ title: "Rename", placeholder: "Name", defaultValue: "Untitled", confirmLabel: "Rename", windowId: "main" })).toEqual({ canceled: false, value: "Draft" });
  expect(calls[0]).toEqual({ method: "show", args: { title: "Rename", windowId: "main", buttons: ["Rename", "Cancel"], defaultButton: 0, cancelButton: 1, input: { placeholder: "Name", defaultValue: "Untitled", secure: false } } });
  reply = () => ({ button: 0, checked: false, value: "" });
  expect(await messages.showPrompt({ title: "Password", secure: true })).toEqual({ canceled: false, value: "" });
  expect(calls[1]!.args.input).toEqual({ defaultValue: "", secure: true });
  for (const button of [1, -1]) {
    reply = () => ({ button, checked: false, value: "typed" });
    expect(await messages.showPrompt({ title: "Rename" })).toEqual({ canceled: true });
  }
  for (const value of [{ button: 0, checked: false }, { button: 0, checked: false, value: 3 }, { button: 2, checked: false, value: "" }]) {
    reply = () => value;
    await expect(messages.showPrompt({ title: "Rename" })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  reply = () => ({ button: 0, checked: false, value: "leak" });
  await expect(messages.showMessage({ title: "No input" })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("prompt options are validated before any native call", async () => {
  calls.length = 0;
  for (const options of [{ title: "" }, { title: "T", secure: "yes" }, { title: "T", placeholder: "" }, { title: "T", defaultValue: 4 }, { title: "T", confirmLabel: "OK\0" }, { title: "T", windowId: "bad.id" }]) await expect(messages.showPrompt(options as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(messages.showPrompt({ title: "T", multiline: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toHaveLength(0);
});

test("the About panel forwards only supplied overrides", async () => {
  await messages.showAboutPanel();
  await messages.showAboutPanel({ name: "Notes", version: "2.1", build: "421", credits: "Made with Spark", copyright: "© 2026 Legend", iconPath: "file:///tmp/My%20Icon.png" });
  expect(calls).toEqual([{ method: "about", args: {} }, { method: "about", args: { name: "Notes", version: "2.1", build: "421", credits: "Made with Spark", copyright: "© 2026 Legend", iconPath: "/tmp/My Icon.png" } }]);
  calls.length = 0;
  for (const options of [{ name: "" }, { iconPath: "relative.png" }, { version: 2 }]) await expect(messages.showAboutPanel(options as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(messages.showAboutPanel({ website: "x" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toHaveLength(0);
  reply = () => 1;
  await expect(messages.showAboutPanel()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
