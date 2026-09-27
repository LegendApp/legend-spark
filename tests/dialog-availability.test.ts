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

import * as updates from "../packages/updates/src/index";
test("updater imports without native modules and reports availability", async () => {
  expect(await updates.getUpdateStatus()).toMatchObject({ available: false, reason: "missing-module" });
  await expect(updates.startUpdates()).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  expect(() => updates.onUpdateEvent(() => {})).toThrow();
});

import * as notifications from "../packages/notifications/src/index";
test("notifications import without installed modules", async () => {
  expect(notifications.getNotificationAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(notifications.getNotificationPermission()).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  await expect(notifications.onNotificationResponse(() => {})).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});

import * as shortcuts from "../packages/desktop-shortcuts/src/api";
import * as globalShortcuts from "../packages/global-shortcuts/src/index";
test("shortcut availability is queryable without installed modules", async () => {
  expect(shortcuts.getShortcutAvailability()).toEqual({ available: false, reason: "missing-module" });
  expect(globalShortcuts.getGlobalShortcutAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(shortcuts.registerShortcut("Cmd+K", () => {})).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  await expect(globalShortcuts.registerGlobalShortcut("Cmd+K", () => {})).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});

import * as contextMenu from "../packages/context-menu/src/index";
test("context menus import without installed native modules", async () => {
  expect(contextMenu.getContextMenuAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(contextMenu.showContextMenu({ windowId: "main", items: [], position: { x: 0, y: 0 } })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});

import * as tray from "../packages/tray/src/index";
test("tray imports without installed native modules", async () => {
  expect(tray.getTrayAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(tray.createTray({ id: "test", title: "Test" })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});

import * as system from "../packages/system/src/index";
test("system imports without installed native modules", async () => {
  expect(system.getSystemAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(system.getSystemInfo()).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});

import * as menus from "../packages/native-menu/src/index";
test("application menus import without installed native modules", async () => {
  expect(menus.getMenuAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(menus.createMenu({ id: "test", items: [] })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});
