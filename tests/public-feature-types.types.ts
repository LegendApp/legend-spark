import type { MenuItem as AppMenuItem, MenuAction as AppMenuAction, AsyncRegistration as MenuRegistration } from "@legendapp/spark/menus";
import type { MenuItem as ContextMenuItem } from "@legendapp/spark/context-menu";
import type { MenuItem as TrayMenuItem, AsyncRegistration as TrayRegistration } from "@legendapp/spark/tray";
import type { MacOSToolbarItem } from "@legendapp/spark/windows/macos";
import type { AsyncRegistration as AppRegistration, Subscription } from "@legendapp/spark/app";
import type { AsyncRegistration as FileRegistration } from "@legendapp/spark/files";

// Compile-only consumer assertions run with the workspace typecheck.
const appMenu: AppMenuItem = { type: "submenu", id: "root", label: "Root", items: [{ type: "role", id: "quit", role: "quit" }] };
const appRoot: import("@legendapp/spark/menus").MenuRootItem = { type: "submenu", id: "root", label: "Root", items: [] };
const trayMenu: TrayMenuItem = { type: "submenu", id: "root", label: "Root", items: [{ type: "action", id: "open", label: "Open" }] };
const contextMenu: ContextMenuItem = { type: "checkbox", id: "enabled", label: "Enabled", checked: true };
const toolbarSlider: MacOSToolbarItem = { type: "menu", id: "audio", items: [{ type: "slider", id: "volume", label: "Volume", min: 0, max: 1, value: 0.5 }] };
const action: AppMenuAction = { type: "action", itemId: "open" };
declare const menuRegistration: MenuRegistration;
declare const trayRegistration: TrayRegistration;
declare const appRegistration: AppRegistration;
declare const fileRegistration: FileRegistration;
declare const subscription: Subscription;
void [appMenu, appRoot, trayMenu, contextMenu, toolbarSlider, action, menuRegistration, trayRegistration, appRegistration, fileRegistration, subscription];

// @ts-expect-error App menus do not support toolbar sliders.
const invalidAppMenu: AppMenuItem = { type: "slider", id: "volume", label: "Volume", min: 0, max: 1, value: 0.5 };
// @ts-expect-error App menu callbacks emit actions, never toolbar value changes.
const invalidAction: AppMenuAction = { type: "valueChanged", itemId: "volume", value: 0.5 };
// @ts-expect-error Context menus do not support submenus.
const invalidContextMenu: ContextMenuItem = { type: "submenu", id: "root", label: "Root", items: [] };
// @ts-expect-error Context menus do not support role commands.
const invalidContextRole: ContextMenuItem = { type: "role", id: "quit", role: "quit" };
// @ts-expect-error Tray menus do not support role commands.
const invalidTrayRole: TrayMenuItem = { type: "role", id: "quit", role: "quit" };
// @ts-expect-error Unsupported entries are excluded recursively, too.
const invalidNestedTrayMenu: TrayMenuItem = { type: "submenu", id: "root", label: "Root", items: [{ type: "slider", id: "volume", label: "Volume", min: 0, max: 1, value: 0.5 }] };

// @ts-expect-error Application menu roots must be submenus.
const invalidAppRoot: import("@legendapp/spark/menus").MenuRootItem = { type: "action", id: "open", label: "Open" };
// @ts-expect-error Context menus do not support keyboard shortcuts.
const invalidContextShortcut: ContextMenuItem = { type: "action", id: "open", label: "Open", shortcut: "Cmd+O" };
// @ts-expect-error Context menus do not support icons.
const invalidContextIcon: ContextMenuItem = { type: "action", id: "open", label: "Open", icon: { type: "symbol", name: "folder" } };
// @ts-expect-error Context menus do not support semantic targets.
const invalidContextTarget: ContextMenuItem = { type: "action", id: "open", label: "Open", target: { menu: "file" } };
// @ts-expect-error Tray menus do not support keyboard shortcuts.
const invalidTrayShortcut: TrayMenuItem = { type: "action", id: "open", label: "Open", shortcut: "Cmd+O" };
// @ts-expect-error Tray menus do not support icons.
const invalidTrayIcon: TrayMenuItem = { type: "action", id: "open", label: "Open", icon: { type: "symbol", name: "folder" } };
// @ts-expect-error Tray menus do not support semantic targets.
const invalidTrayTarget: TrayMenuItem = { type: "action", id: "open", label: "Open", target: { menu: "file" } };

// @ts-expect-error Toolbar menu runtime does not support role commands.
const invalidToolbarRole: MacOSToolbarItem = { type: "menu", id: "file", items: [{ type: "role", id: "quit", role: "quit" }] };
// @ts-expect-error Toolbar menu runtime does not support nested submenus.
const invalidToolbarSubmenu: MacOSToolbarItem = { type: "menu", id: "file", items: [{ type: "submenu", id: "group", label: "Group", items: [] }] };
// @ts-expect-error Toolbar menu runtime does not support targeting.
const invalidToolbarTarget: MacOSToolbarItem = { type: "menu", id: "file", items: [{ type: "action", id: "open", label: "Open", target: { id: "other" } }] };
