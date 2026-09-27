import { expect, test, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => null } }));
import { getFileDialogAvailability, openFileDialog } from "../packages/file-dialog/src/index";
import { getMessageDialogAvailability, showMessage } from "../packages/message-dialog/src/index";
import { getFileSystemAvailability, readText } from "../packages/file-system/src/index";
test("dialog entry points import without installed modules and reject actual operations", async () => {
  expect(getFileSystemAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(readText("/file")).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  expect(getFileDialogAvailability()).toEqual({ available: false, reason: "missing-module" });
  expect(getMessageDialogAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(openFileDialog()).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  await expect(showMessage({ title: "Unavailable" })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});

import * as clipboard from "../packages/clipboard/src/desktop";
import * as storage from "../packages/secure-storage/src/desktop";
test("desktop Expo subsets report missing native modules without failing at import", async () => {
  expect(await storage.isAvailableAsync()).toBe(false);
  await expect(storage.getItemAsync("key")).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  expect(clipboard.getRichClipboardAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(clipboard.getStringAsync()).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});
