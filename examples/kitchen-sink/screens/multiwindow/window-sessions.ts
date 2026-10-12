import { useEffect, useSyncExternalStore } from "react";
import * as links from "@legendapp/spark/links";
import { SparkError } from "@legendapp/spark/contracts";
import { settings, type Json } from "@legendapp/spark/settings";
import { getWindow, getWindowSessionAvailability, setWindowBounds, type WindowInstance, type WindowSession } from "@legendapp/spark/windows";
import { PINNED, addStar, adoptNote, nextNoteTitle, noteMessages, noteNumber, noteTitles, noteViews, stars, type NoteView } from "./state";
import { openNote, windows } from "./windows";

/**
 * Multiwindow > Sessions and messages: saves the open windows as a window session (frames, routes,
 * scroll offsets, selections and sidebar widths) to Spark settings, restores it after closing the
 * windows or relaunching, opens New Window copies, and sends typed requests and broadcasts.
 * `spark-ks://multiwindow/windows?run=<step>,…` runs the same operations for the flows.
 */
const SAVED = "ks-multiwindow-session";
export type NoteRow = { label: string; view: NoteView | null; frame: { x: number; y: number; width: number; height: number } };
export type SessionsState = {
  /** The live session's note windows, read with getSession() whenever subscribeToSession reports a change. */
  rows: NoteRow[];
  /** Tab groups of note windows: labels in tab order, then the selected one. */
  tabs: string[];
  saved: number | null;
  reply: string | null;
  delivered: number | null;
  /** What the main window heard: word and sender. */
  heard: string | null;
  steps: number;
  error: string | null;
};
let state: SessionsState = { rows: [], tabs: [], saved: null, reply: null, delivered: null, heard: null, steps: 0, error: null };
const listeners = new Set<() => void>();
function update(change: Partial<SessionsState>) { state = { ...state, ...change }; for (const listener of [...listeners]) listener(); }
const errorText = (error: unknown) => error instanceof SparkError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
const label = (window: { id: string }) => noteNumber(noteTitles.get(window.id) ?? window.id);

// The latest refresh wins: an earlier session read that resolves late never overwrites it.
let refreshes = 0;
async function refresh() {
  const ticket = ++refreshes;
  const session = await windows.getSession();
  if (ticket !== refreshes) return;
  const notes = session.windows.filter(window => window.name === "note");
  const rows = notes.map(window => ({
    label: noteNumber(String(window.props?.title ?? window.id)),
    view: (window.state["ks-note-view"] as NoteView | undefined) ?? null,
    frame: { x: Math.round(window.bounds.x), y: Math.round(window.bounds.y), width: Math.round(window.bounds.width), height: Math.round(window.bounds.height) },
  }));
  const labels = new Map(notes.map((window, index) => [window.id, rows[index]!.label]));
  const tabs = session.tabGroups.map(group => `${group.windowIds.map(id => labels.get(id) ?? "other").join("-")}-selected-${group.selectedWindowId ? labels.get(group.selectedWindowId) ?? "other" : "none"}`);
  update({ rows, tabs });
}
const refreshNow = () => { refresh().catch(error => update({ error: errorText(error) })); };
windows.subscribeToSession(refreshNow);
noteMessages.addListener("highlight", ({ word }, from) => update({ heard: `${word}-from-${from ? label(from) : "main"}` }));

const note = (number: string): WindowInstance => {
  const window = windows.list("note").find(item => label(item) === number);
  if (!window) throw new Error(`No note ${number} is open`);
  return window;
};
async function duplicate(number: string, options: { detached?: boolean; tab?: boolean }) {
  const title = nextNoteTitle();
  const window = await windows.duplicate(note(number), { ...options, props: { title }, options: { title } });
  adoptNote(window, title);
}
async function restore() {
  const saved = await settings.get(SAVED);
  if (!saved) throw new Error("No saved session");
  const session = saved as unknown as WindowSession;
  const restored = await windows.restoreSession(session);
  restored.forEach((window, index) => {
    const title = session.windows[index]!.props?.title;
    if (window.name === "note" && typeof title === "string") adoptNote(window, title);
  });
}
async function closeNotes() {
  for (const window of windows.list("note")) await window.close();
}

/**
 * One step: `open`, `route-<n>-document|details`, `scroll-<n>-<y>`, `select-<n>-<item>`, `split-<n>-<width>`,
 * `frame-<n>-<x>-<y>-<w>-<h>`, `star-<n>`, `promote-<n>` (stars to app scope), `duplicate-<n>` (New Window),
 * `detach-<n>` (New Window, detached), `tab-<n>` (New Window as a tab), `save`, `close` (every note window),
 * `restore`, `request-<n>` (ask note n for its summary), `broadcast-<word>` (from the main window) and
 * `broadcast-<n>-<word>` (from note n).
 */
export const STEP = /^(open|save|close|restore|route-\d+-(?:document|details)|scroll-\d+-\d+|select-\d+-\d+|split-\d+-\d+|frame-\d+-\d+-\d+-\d+-\d+|star-\d+|promote-\d+|duplicate-\d+|detach-\d+|tab-\d+|request-\d+|broadcast-(?:\d+-)?[a-z]+)$/;
async function step(name: string) {
  const [verb, ...rest] = name.split("-") as [string, ...string[]];
  const [target = "", value = ""] = rest;
  if (verb === "open") return void await openNote();
  if (verb === "save") {
    const session = await windows.getSession();
    await settings.set(SAVED, session as unknown as Json);
    return update({ saved: session.windows.length });
  }
  if (verb === "close") return closeNotes();
  if (verb === "restore") return restore();
  if (verb === "broadcast") {
    const [from, word] = rest.length === 2 ? [note(target), value] : [undefined, target];
    return update({ delivered: noteMessages.broadcast("highlight", { word: word! }, { from }) });
  }
  const window = note(target), view = noteViews.get(window);
  if (verb === "route") return view.route.set(value as NoteView["route"]);
  if (verb === "scroll") return view.scrollY.set(Number(value));
  if (verb === "select") return view.selected.set(Number(value));
  if (verb === "split") return view.split.set(Number(value));
  if (verb === "frame") {
    const [x, y, width, height] = rest.slice(1).map(Number) as [number, number, number, number];
    return setWindowBounds(window.id, { displayId: (await getWindow(window.id)).bounds.displayId, x, y, width, height });
  }
  if (verb === "star") return addStar(window);
  if (verb === "promote") return void stars.promote(window, PINNED);
  if (verb === "duplicate" || verb === "detach" || verb === "tab") return duplicate(target, { detached: verb === "detach", tab: verb === "tab" });
  const { title, route, scrollY, selected, split, stars: count } = await noteMessages.request(window, "summary", null, { timeoutMs: 5000 });
  update({ reply: `${noteNumber(title)}-${route}-${scrollY}-${selected ?? "none"}-${split}-${count}` });
}

/** Runs steps in order. A step that rejects shows its error; later steps still run. */
export async function runSteps(steps: readonly string[]) {
  update({ steps: 0, error: null });
  for (const [index, name] of steps.entries()) {
    try { await step(name); } catch (error) { update({ error: errorText(error) }); }
    await refresh().catch(error => update({ error: errorText(error) }));
    update({ steps: index + 1 });
  }
}
/** Buttons: the same operations, aimed at note 1. */
export const actions = {
  save: () => runSteps(["save"]),
  close: () => runSteps(["close"]),
  restore: () => runSteps(["restore"]),
  duplicate: () => runSteps(["duplicate-1"]),
  detach: () => runSteps(["detach-1"]),
  request: () => runSteps(["request-1"]),
  broadcast: () => runSteps(["broadcast-hello"]),
};
export function sessionTabsAvailability() {
  const availability = getWindowSessionAvailability("tabs");
  return availability.available ? "available" : availability.reason;
}

/** `spark-ks://multiwindow/windows?run=<step>,<step>…`: the steps to run, or null for any other URL. */
export function parseRunLink(url: string): string[] | null {
  const query = /^spark-ks:\/\/multiwindow\/windows\?(.*)$/i.exec(url)?.[1];
  const run = query?.split("&").find(pair => pair.startsWith("run="))?.slice(4);
  if (run === undefined) return null;
  const steps = run.split(",").filter(Boolean);
  for (const name of steps) if (!STEP.test(name)) throw new Error(`Unknown multiwindow step: ${name}`);
  return steps;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useSessions() {
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
