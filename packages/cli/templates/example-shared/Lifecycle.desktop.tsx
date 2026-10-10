import { useEffect } from "react";
import { Platform } from "react-native";
import { beforeWindowClose, setWindowOptions, addWindowListener } from "@legendapp/spark/windows";
import { beforeQuit } from "@legendapp/spark/app";
import { createMenu, type MenuRootItem } from "@legendapp/spark/menus";
import { registerShortcut } from "@legendapp/spark/shortcuts";
import { mountSerial } from "./lifetime";
import type { LifecycleProps } from "./lifecycle-types";
export function Lifecycle({ title, windowId = "main", flush, quit, commands, onError }: LifecycleProps) {
  useEffect(() => { void setWindowOptions(windowId, { title: title }).catch(error => onError(String(error))); }, [title, windowId, onError]);
  useEffect(() => mountSerial(`window-${windowId}`, async retain => {
    const owner = `example-${windowId}`;
    const items: MenuRootItem[] = [{ type: "submenu", id: "file", target: { menu: "file" }, label: "File", items: commands.map(({ id, title, key }) => ({ type: "action", id, label: title, shortcut: `CmdOrCtrl+${key}` })) }];
    const menu = await createMenu({ id: owner, items, onAction: event => { commands.find(command => command.id === event.itemId)?.run(); } });
    await retain(Promise.resolve(menu));
    await retain(addWindowListener(windowId, "focusChanged", event => { if (event.focused) void menu.update({ items }).catch(error => onError(String(error))); }));
    const guarded = (save: () => Promise<boolean>) => async () => {
      try { return await save(); } catch (error) { onError(String(error)); return false; }
    };
    await retain(beforeWindowClose(windowId, guarded(flush)));
    if (windowId === "main") await retain(beforeQuit(guarded(quit ?? flush)));
    for (const command of commands) await retain(registerShortcut(`${Platform.OS === "windows" ? "Control" : "Command"}+${command.key}`, command.run, { windowId }));
  }, onError), [windowId, flush, quit, commands, onError]);
  return null;
}
