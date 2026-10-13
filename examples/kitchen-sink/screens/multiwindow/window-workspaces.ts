import { useEffect, useSyncExternalStore } from "react";
import * as links from "@legendapp/spark/links";
import * as files from "@legendapp/spark/files";
import { SparkError } from "@legendapp/spark/contracts";
import {
  createWindowWorkspaces, createWindowsNavigator, getDisplays, getWindowWorkspaceAvailability, setWindowBounds,
  type WindowWorkspaces, type WorkspacePlacement,
} from "@legendapp/spark/windows";
import { getAppState, subscribeToAppState } from "../../shell/app-controller";
import { WORKSPACES_MESSAGES } from "./workspaces-messages";
import { WorkspaceWindow } from "./WorkspaceWindow";

/**
 * Multiwindow > Workspaces (docs/api-window-contract.md#workspaces): editor and inspector windows saved as named
 * workspaces in the app's data directory, restored from the screen, from Window ▸ Workspaces or with ⌃⌘1…9, and adapted
 * to the displays connected now. The readout lists the connected displays, the saved workspaces, the open windows'
 * frames as the window API reports them, and where the last restore placed each window, so driver flows (which never
 * show windows) can check them.
 */
export type DisplayRow = { id: string; persistentId: string | null; primary: boolean; width: number; height: number };
export type WindowRow = { label: string; displayId: string; x: number; y: number; width: number; height: number };
export type SavedRow = { name: string; windows: number; displays: number };
export type WorkspacesState = {
  name: string; displays: DisplayRow[]; saved: SavedRow[] | null; windows: WindowRow[];
  /** The last restore: each window's label, display and layout, or why it stopped. */
  restore: { placements: (WorkspacePlacement & { label: string })[] } | { stopped: string } | null;
  runs: number; steps: number; error: string | null;
};
let state: WorkspacesState = { name: "Desk", displays: [], saved: null, windows: [], restore: null, runs: 0, steps: 0, error: null };
const listeners = new Set<() => void>();
function update(change: Partial<WorkspacesState>) { state = { ...state, ...change }; for (const listener of listeners) listener(); }
const errorText = (error: unknown) => error instanceof SparkError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
const report = (error: unknown) => update({ error: errorText(error) });
export const setName = (name: string) => update({ name });

const navigator = createWindowsNavigator({
  editor: { component: WorkspaceWindow, options: { size: { width: 640, height: 480 } } },
  inspector: { id: "ks-ws-inspector", component: WorkspaceWindow, options: { title: "Inspector", size: { width: 300, height: 480 } } },
}, { onError: event => report(event.error) });
let editors = 0;

export function availability() {
  const result = getWindowWorkspaceAvailability();
  return result.available ? "available" : result.reason;
}
// Created once for the app: Save Workspace… saves under the name typed on this screen. The menu follows the app's language.
const menuLabels = () => WORKSPACES_MESSAGES[getAppState().locale ?? "en"].menu;
const workspaces: Promise<WindowWorkspaces> = createWindowWorkspaces(navigator, {
  menu: { labels: menuLabels(), requestName: () => state.name.trim() || null, saveShortcut: "CmdOrCtrl+Alt+S", restoreShortcuts: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => `Ctrl+CmdOrCtrl+${digit}`) },
  onError: report,
});
workspaces.then(controller => {
  controller.subscribe(() => { refresh().catch(report); });
  let labels = menuLabels();
  const relabel = () => { const next = menuLabels(); if (next !== labels) { labels = next; controller.setMenuLabels(next).catch(report); } };
  subscribeToAppState(relabel);
  relabel();
}, () => {});
navigator.subscribe(() => { refresh().catch(report); });

const labelOf = (props: Record<string, unknown> | null) => typeof props?.label === "string" ? props.label : "?";
// The latest refresh wins: an earlier read that resolves late never overwrites it.
let refreshes = 0;
export async function refresh() {
  const ticket = ++refreshes;
  const [displays, session] = await Promise.all([getDisplays(), navigator.getSession()]);
  let saved: SavedRow[] | null = null, error: unknown;
  try { saved = (await (await workspaces).list()).map(item => ({ name: item.name, windows: item.session.windows.length, displays: item.displays.length })); }
  catch (cause) { error = cause; }
  if (ticket !== refreshes) return;
  update({
    displays: displays.map(({ id, persistentId, primary, workArea }) => ({ id, persistentId, primary, width: workArea.width, height: workArea.height })),
    windows: session.windows.map(({ props, bounds }) => ({ label: labelOf(props), displayId: bounds.displayId, x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) })),
    saved,
  });
  if (error) report(error);
}
export const refreshNow = () => { refresh().catch(report); };

async function frame(label: string, displayId: string, x: number, y: number, width: number, height: number) {
  const window = (await navigator.getSession()).windows.find(item => labelOf(item.props) === label);
  if (!window) throw new Error(`No ${label} window is open`);
  await setWindowBounds(window.id, { displayId, x, y, width, height });
}
async function restore(name: string) {
  const result = await (await workspaces).restore(name);
  if (!result.restored) {
    if (result.reason === "failed") report(result.error);
    return update({ restore: { stopped: `${result.reason}-${"windowId" in result ? result.windowId : "none"}-${result.rolledBack ? "rolled-back" : "not-rolled-back"}` } });
  }
  const labels = new Map((await navigator.getSession()).windows.map(window => [window.id, labelOf(window.props)]));
  update({ restore: { placements: result.placements.map(placement => ({ ...placement, label: labels.get(placement.windowId) ?? "?" })) } });
}
/** Writes text that is not a workspace list over the workspaces file, as a damaged disk or a hand edit would. */
async function corrupt() {
  const root = await files.getDirectory("data");
  await files.writeText(`${root}/workspaces.json`, "{ \"version\": 1, \"workspaces\": [ { \"name\": ");
}

/**
 * One step: `editor` (opens E1, E2…), `inspector`, `frame-<label>-<displayId>-<x>-<y>-<w>-<h>`, `save-<name>`,
 * `restore-<name>`, `rename-<name>-<new name>`, `delete-<name>`, `close` (every window of this screen), `clear`
 * (deletes the workspaces file), `corrupt` (damages it), `list` (reads it again) and `name-<name>` (types the name
 * Window ▸ Workspaces ▸ Save Workspace… saves under).
 */
const STEP = /^(editor|inspector|close|clear|corrupt|list|name-[A-Za-z0-9]+|frame-[A-Za-z0-9]+-[A-Za-z0-9]+-\d+-\d+-\d+-\d+|(?:save|restore|delete)-[A-Za-z0-9]+|rename-[A-Za-z0-9]+-[A-Za-z0-9]+)$/;
async function step(name: string) {
  const [verb, ...rest] = name.split("-") as [string, ...string[]];
  const argument = name.slice(verb.length + 1);
  const controller = await workspaces;
  if (verb === "editor") { const label = `E${++editors}`; return void await navigator.openInstance("editor", { props: { label }, options: { title: `Editor ${label}` } }); }
  if (verb === "inspector") return void await navigator.openInstance("inspector", { props: { label: "I" } });
  if (verb === "frame") { const [label, displayId, ...numbers] = rest as [string, string, ...string[]]; const [x, y, w, h] = numbers.map(Number) as [number, number, number, number]; return frame(label, displayId, x, y, w, h); }
  if (verb === "name") return setName(argument);
  if (verb === "save") return void await controller.save(argument);
  if (verb === "restore") return restore(argument);
  if (verb === "rename") return controller.rename(rest[0]!, rest[1]!);
  if (verb === "delete") return controller.delete(argument);
  if (verb === "clear") return controller.clear();
  if (verb === "corrupt") return corrupt();
  if (verb === "close") { for (const window of navigator.list()) await window.close(); return; }
}
/** Runs steps in order. A failing step shows its error; later steps still run. */
export async function runSteps(steps: readonly string[]) {
  update({ runs: state.runs + 1, steps: 0, error: null });
  for (const [index, name] of steps.entries()) {
    try { await step(name); } catch (error) { report(error); }
    await refresh().catch(report);
    update({ steps: index + 1 });
  }
}
/** A button: one step, keeping the error of a failing step. */
export async function runStep(name: string) {
  update({ error: null });
  try { await step(name); } catch (error) { report(error); } finally { await refresh().catch(report); }
}

/** `spark-ks://multiwindow/workspaces?run=<step>,<step>…`, or null for any other URL. */
export function parseRunLink(url: string): string[] | null {
  const run = /^spark-ks:\/\/multiwindow\/workspaces\?(.*)$/i.exec(url)?.[1]?.split("&").find(pair => pair.startsWith("run="))?.slice(4);
  if (run === undefined) return null;
  const steps = run.split(",").filter(Boolean);
  for (const name of steps) if (!STEP.test(name)) throw new Error(`Unknown workspace step: ${name}`);
  return steps;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useWorkspacesState() { return useSyncExternalStore(subscribe, () => state); }
export function useWindowWorkspaces() {
  useRunLinks();
  useInitialRefresh();
  return useWorkspacesState();
}
function useInitialRefresh() { useEffect(refreshNow, []); }
function useRunLinks() {
  useEffect(() => {
    const subscription = links.addEventListener("url", ({ url }) => {
      let steps: string[] | null;
      try { steps = parseRunLink(url); } catch (error) { report(error); return; }
      if (steps) runSteps(steps).catch(report);
    });
    return () => subscription.remove();
  }, []);
}
