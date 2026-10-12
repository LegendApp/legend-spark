import { useSyncExternalStore } from "react";
import * as Runtimes from "@react-native-runtimes/core";
import { createWindowsNavigator } from "@legendapp/spark/windows";
import { IsolatedPanel } from "../../multiwindow-tasks";
import { addStar, adoptNote, nextNoteTitle, reportWindowError } from "./state";
import { CrashWindow, NoteWindow, SettingsWindow } from "./WindowContents";

export const windows = createWindowsNavigator({
  note: {
    component: NoteWindow,
    options: { size: { width: 680, height: 480 } },
    undoMenu: true,
    menus: () => [{ type: "submenu", id: "multiwindow-note", label: "Note", items: [{ type: "action", id: "multiwindow-note-star", label: "Add Star" }] }],
    onMenuAction: (action, window) => { if (action.itemId === "multiwindow-note-star") addStar(window); },
  },
  settings: { id: "multiwindow-settings", component: SettingsWindow, options: { title: "Multiwindow Settings", size: { width: 420, height: 240 } } },
  crash: { component: CrashWindow, options: { title: "Error isolation", size: { width: 460, height: 300 } } },
  plugin: { component: IsolatedPanel, runtime: { isolated: "ks-plugins", module: Runtimes }, options: { title: "Isolated runtime", size: { width: 520, height: 360 } } },
}, { onError: reportWindowError });

export async function openNote() {
  const title = nextNoteTitle();
  const window = await windows.openInstance("note", { props: { title }, options: { title } });
  adoptNote(window, title);
  return window;
}

// One snapshot per navigator change, updated before React's subscribers run.
let snapshot = { open: windows.list(), key: windows.getKeyWindowId() };
windows.subscribe(() => { snapshot = { open: windows.list(), key: windows.getKeyWindowId() }; });
const subscribe = (changed: () => void) => { const subscription = windows.subscribe(changed); return () => subscription.remove(); };
export function useOpenWindows() { return useSyncExternalStore(subscribe, () => snapshot); }
