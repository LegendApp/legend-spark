import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import * as links from "@legendapp/spark/links";
import { SparkError } from "@legendapp/spark/contracts";
import {
  addWindowListener, closeWindow, createWindowsNavigator, getWindowAvailability, getWindowTabGroup, listWindowTabGroups, mergeAllWindows, moveTabToNewWindow,
  selectWindowTab, setWindowTabBarVisible, type WindowInstance,
} from "@legendapp/spark/windows";
import { TabWindow } from "./TabWindow";

/**
 * Windows > Window tabs: a window type whose windows share one tabbing identifier, the tab operations on
 * them, and a readout of their tab groups and tab events. Windows are named by number (window 1, 2, …).
 * Window tabs are macOS-only for now (#295), so on Windows the navigator is never created.
 */
let next = 1;
const label = () => String(next++);
export const tabWindows = Platform.OS === "macos" ? createWindowsNavigator({
  tab: {
    component: TabWindow,
    options: { size: { width: 520, height: 320 }, tabbing: { identifier: "ks-window-tabs" } },
    // The tab bar's + button, and Window ▸ New Tab (⌘T) while a tab window is key.
    newTab: () => { const name = label(); return { name: "tab", props: { label: name }, options: { title: `Tab ${name}` } }; },
    menus: () => [{ type: "submenu", id: "windows-window-tabs-menu", label: "Window", target: { menu: "window" }, items: [
      { type: "role", id: "windows-window-tabs-new-tab", role: "newTab", label: "New Tab", shortcut: "CmdOrCtrl+T" },
    ] }],
  },
}, { onError: ({ phase, error }) => update({ error: `${phase}: ${errorText(error)}` }) }) : null;

export type TabGroupRow = { labels: string[]; selected: string | null; tabBarVisible: boolean };
export type WindowTabsState = {
  groups: TabGroupRow[];
  /** Window 1's last tabGroupChanged event (its group's windows) and tabSelectionChanged event (the selected window). */
  groupEvent: string | null;
  selectionEvent: string | null;
  /** Steps finished by the last deep-link run. */
  steps: number;
  error: string | null;
};
let state: WindowTabsState = { groups: [], groupEvent: null, selectionEvent: null, steps: 0, error: null };
const listeners = new Set<() => void>();
function update(change: Partial<WindowTabsState>) { state = { ...state, ...change }; for (const listener of listeners) listener(); }
const errorText = (error: unknown) => error instanceof SparkError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);

/** Window ID → number, for this screen's windows only. */
const labels = new Map<string, string>();
const labelsOf = (ids: readonly string[]) => ids.map(id => labels.get(id)).filter((value): value is string => value !== undefined);
const idOf = (name: string) => {
  for (const [id, value] of labels) if (value === name) return id;
  throw new Error(`No window ${name} is open`);
};

// The latest refresh wins: an earlier query that resolves late never overwrites it.
let refreshes = 0;
async function refresh() {
  const ticket = ++refreshes;
  const groups = await listWindowTabGroups();
  if (ticket !== refreshes) return;
  const rows = groups.map(group => ({ labels: labelsOf(group.windowIds), selected: group.selectedWindowId ? labels.get(group.selectedWindowId) ?? null : null, tabBarVisible: group.tabBarVisible }))
    .filter(row => row.labels.length).sort((a, b) => Number(a.labels[0]) - Number(b.labels[0]));
  update({ groups: rows });
}
const refreshNow = () => { refresh().catch(error => update({ error: errorText(error) })); };
tabWindows?.subscribe(() => {
  for (const id of [...labels.keys()]) if (!tabWindows.get(id)) labels.delete(id);
  refreshNow();
});

/** Tracks a tab window and its tab events. Idempotent: the screen and the window's own root both call it. */
export function adoptTabWindow(window: WindowInstance, name: string) {
  if (labels.has(window.id)) return;
  labels.set(window.id, name);
  const report = (error: unknown) => update({ error: errorText(error) });
  // Every window refreshes the readout; window 1's events are shown, so the readout does not depend on delivery order.
  const first = name === "1";
  addWindowListener(window.id, "tabGroupChanged", event => { if (first) update({ groupEvent: labelsOf(event.tabGroup.windowIds).join("-") }); refreshNow(); }, { onError: report }).catch(report);
  addWindowListener(window.id, "tabSelectionChanged", event => { if (first) update({ selectionEvent: event.selectedWindowId ? labels.get(event.selectedWindowId) ?? "other" : "other" }); refreshNow(); }, { onError: report }).catch(report);
  refreshNow();
}

async function open(tabbedWith?: string, disallowed = false) {
  if (!tabWindows) {
    // Window tabs are macOS-only (#295): Spark rejects every tab operation with E_UNSUPPORTED_PLATFORM.
    await listWindowTabGroups();
    throw new Error("listWindowTabGroups resolved on a platform without window tabs");
  }
  const name = label();
  const window = await tabWindows.openInstance("tab", { props: { label: name }, options: {
    title: `Tab ${name}`, ...(tabbedWith ? { tabbedWith: idOf(tabbedWith) } : {}), ...(disallowed ? { tabbing: { mode: "disallowed" } } : {}),
  } });
  adoptTabWindow(window, name);
}
async function closeAll() {
  await Promise.all([...labels.keys()].map(id => closeWindow(id)));
  labels.clear(); next = 1;
}

/**
 * One step of a run: `open`, `disallowed` (a window that never tabs), `tab-<n>` (new tab in window n's group),
 * `select-<n>`, `next-<n>` (select the tab after window n's group's selected tab), `merge-<n>`, `move-<n>`
 * (to a new window), `bar-<n>-show|hide`, `close-<n>`.
 */
export const STEP = /^(open|disallowed|tab-\d+|select-\d+|next-\d+|merge-\d+|move-\d+|bar-\d+-(?:show|hide)|close-\d+)$/;
async function step(name: string) {
  const [verb, target, value] = name.split("-") as [string, string, string?];
  if (verb === "open" || verb === "disallowed") return open(undefined, verb === "disallowed");
  if (verb === "tab") return open(target);
  const id = idOf(target);
  if (verb === "select") return selectWindowTab(id);
  if (verb === "next") {
    const { windowIds, selectedWindowId } = await getWindowTabGroup(id);
    return selectWindowTab(windowIds[(windowIds.indexOf(selectedWindowId ?? id) + 1) % windowIds.length]!);
  }
  if (verb === "merge") return mergeAllWindows(id);
  if (verb === "move") return moveTabToNewWindow(id);
  if (verb === "bar") return setWindowTabBarVisible(id, value === "show");
  await closeWindow(id);
}

/** Runs steps in order from a fresh start. A step that rejects shows its error; later steps still run. */
export async function runSteps(steps: readonly string[]) {
  await closeAll();
  update({ steps: 0, error: null, groupEvent: null, selectionEvent: null });
  for (const [index, name] of steps.entries()) {
    try { await step(name); } catch (error) { update({ error: errorText(error) }); }
    await refresh();
    update({ steps: index + 1 });
  }
}
/** Buttons: the same operations, aimed at window 1 or its group. */
export const actions = {
  open: () => step("open"),
  openDisallowed: () => step("disallowed"),
  newTab: () => step("tab-1"),
  selectNext: () => step("next-1"),
  merge: () => step("merge-1"),
  moveSelected: async () => {
    const { selectedWindowId } = await getWindowTabGroup(idOf("1"));
    await moveTabToNewWindow(selectedWindowId ?? idOf("1"));
  },
  toggleTabBar: async () => step(`bar-1-${(await getWindowTabGroup(idOf("1"))).tabBarVisible ? "hide" : "show"}`),
  closeAll: () => closeAll(),
};
export function tabbingAvailability() {
  const availability = getWindowAvailability("tabbing");
  return availability.available ? "available" : availability.reason;
}

/** `spark-ks://windows/window-tabs?run=<step>,<step>…`: the steps to run, or null for any other URL. */
export function parseRunLink(url: string): string[] | null {
  const query = /^spark-ks:\/\/windows\/window-tabs\?(.*)$/i.exec(url)?.[1];
  const run = query?.split("&").find(pair => pair.startsWith("run="))?.slice(4);
  if (run === undefined) return null;
  const steps = run.split(",").filter(Boolean);
  for (const name of steps) if (!STEP.test(name)) throw new Error(`Unknown window tabs step: ${name}`);
  return steps;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useWindowTabs() {
  useRunLinks();
  return useSyncExternalStore(subscribe, () => state);
}
function useRunLinks() {
  useEffect(() => {
    const subscription = links.addEventListener("url", ({ url }) => {
      let steps: string[] | null;
      try { steps = parseRunLink(url); } catch (error) { update({ error: errorText(error) }); return; }
      if (steps) runSteps(steps).catch(error => update({ error: errorText(error) }));
    });
    return () => subscription.remove();
  }, []);
}
/** Called from each tab window's root, so windows opened by the + button are tracked too. */
export function useAdoptTabWindow(window: WindowInstance, name: string) {
  useEffect(() => { adoptTabWindow(window, name); }, [window, name]);
}
