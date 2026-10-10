import { useSyncExternalStore } from "react";
import { Alert } from "react-native";
import * as app from "@legendapp/spark/app";
import * as documents from "@legendapp/spark/app/documents";
import { openFileDialog, saveFileDialog } from "@legendapp/spark/dialogs";
import * as files from "@legendapp/spark/files";
import { createMenu } from "@legendapp/spark/menus";
import { registerShortcut } from "@legendapp/spark/shortcuts";
import { getSystemInfo } from "@legendapp/spark/system";
import * as windows from "@legendapp/spark/windows";
import { eventEntry, type Entry } from "../EventResults";
import { reportLaunch } from "../launch";
import { MESSAGES, isRTL, resolveLocale, type Locale, type Messages } from "./i18n";
import { listenForDeepLinks } from "./navigation";

// The Kitchen Sink's app-wide state and registrations: the Document menu, ⌘⇧K, the unsaved-changes
// prompts on quit and main-window close, and deep links. They live for the process; screens observe them.
export type DocumentState = { path: string; text: string; saved: string };
export type ActivityLog = "menuEvents" | "fileEvents";
export type AppState = {
  /** Set once the system locale is read; the Shell renders after this. */
  locale?: Locale;
  errors: readonly string[];
  document: DocumentState;
  menuEvents: readonly Entry[];
  fileEvents: readonly Entry[];
};

let state: AppState = { errors: [], document: { path: "", saved: "", text: "Hello from a native desktop app.\n" }, menuEvents: [], fileEvents: [] };
const listeners = new Set<() => void>();
let sequence = 0;

function update(next: Partial<AppState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}
function fail(error: unknown) { update({ errors: [...state.errors, error instanceof Error ? error.message : String(error)] }); }
function strings(): Messages {
  if (!state.locale) throw new Error("The Kitchen Sink locale has not been read yet.");
  return MESSAGES[state.locale];
}

export function getAppState(): AppState { return state; }
export function subscribeToAppState(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Appends to a screen-visible activity list; Errors show as failures. */
export function logActivity(log: ActivityLog, value: unknown) { update({ [log]: [...state[log].slice(-5), eventEntry(++sequence, value)] }); }

export function setDocumentText(text: string) { update({ document: { ...state.document, text } }); }

export async function openDocument() {
  const selected = await openFileDialog({ title: strings().openDialogTitle, filters: [{ extensions: ["txt", "md", "json"] }], multiple: false });
  if (selected.canceled) return "Open cancelled.";
  const path = selected.paths[0]; const text = await files.readText(path);
  update({ document: { path, text, saved: text } }); await documents.noteRecentDocument(path); logActivity("fileEvents", `Opened ${path}`);
}

export async function saveDocument() {
  const current = state.document;
  const result = current.path ? { canceled: false as const, path: current.path } : await saveFileDialog({ defaultName: strings().untitledName });
  if (result.canceled) return "Save cancelled.";
  await files.writeText(result.path, current.text);
  update({ document: { ...state.document, path: result.path, saved: current.text } }); logActivity("fileEvents", `Saved ${result.path}`);
}

function confirmDiscard(): boolean | Promise<boolean> {
  if (state.document.text === state.document.saved) return true;
  const t = strings();
  return new Promise(resolve => Alert.alert(t.unsavedTitle, t.unsavedMessage, [
    { text: t.keepEditing, style: "cancel", onPress: () => resolve(false) },
    { text: t.discard, style: "destructive", onPress: () => resolve(true) },
  ]));
}

/** Called once from index.ts. Report launches install nothing; failures are shown by the Shell. */
export async function startAppController(): Promise<void> {
  try {
    const context = await app.getAppContext();
    if (reportLaunch(context.launchArguments)) return;
    update({ locale: resolveLocale((await getSystemInfo()).locale) });
  } catch (error) { fail(error); return; }
  const t = strings();
  listenForDeepLinks(fail);
  await Promise.all([
    createMenu({
      id: "kitchen-sink",
      items: [{ type: "submenu", id: "document", label: t.documentMenu, items: [{ type: "action", id: "open", label: t.openItem, shortcut: "CmdOrCtrl+O" }, { type: "action", id: "save", label: t.saveItem, shortcut: "CmdOrCtrl+S" }] }],
      onAction: ({ itemId }) => {
        logActivity("menuEvents", `Document menu: ${itemId}`);
        (itemId === "open" ? openDocument() : saveDocument()).catch(error => logActivity("fileEvents", error));
      },
    }),
    registerShortcut("Command+Shift+K", () => logActivity("menuEvents", "Shortcut fired: Command+Shift+K")),
    app.beforeQuit(confirmDiscard),
    windows.beforeWindowClose("main", confirmDiscard),
  ].map(registration => registration.catch(fail)));
}

export function useAppState<T>(select: (state: AppState) => T): T {
  return useSyncExternalStore(subscribeToAppState, () => select(state));
}
/** Shell strings and direction; only valid below the Shell, which waits for the locale. */
export function useI18n(): { locale: Locale; t: Messages; rtl: boolean } {
  const locale = useAppState(current => current.locale);
  if (!locale) throw new Error("useI18n is only available after the Kitchen Sink locale has been read.");
  return { locale, t: MESSAGES[locale], rtl: isRTL(locale) };
}
