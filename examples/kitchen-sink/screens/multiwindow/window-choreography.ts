import { useEffect, useSyncExternalStore, type RefObject } from "react";
import type { View } from "react-native";
import * as links from "@legendapp/spark/links";
import { getAppearancePreferences, onSystemEvent } from "@legendapp/spark/system";
import { SparkError } from "@legendapp/spark/contracts";
import {
  animateWindowBounds, attachWindow, closeWindow, openWindow, createWindowsNavigator, getDisplays, getWindow, getWindowChoreographyAvailability, openWindowFrom, setWindowBounds,
  setWindowCloseTransition, stopWindowAnimation,
  type CloseResult, type WindowAnimationResult, type WindowAttachment, type WindowChoreographyFeature, type WindowContentRect, type WindowInstance,
} from "@legendapp/spark/windows";
import { ChoreographyInspector } from "./ChoreographyInspector";

/**
 * Multiwindow > Window choreography (docs/api-window-contract.md#window-choreography): a detail window that zooms out of
 * a list row (or a thumbnail) and shrinks back into it, compact↔full and Settings pane resizes, a notes panel torn off
 * into a window and merged back into its slot, an inspector and a palette docked to the main window. The readout lists
 * each window's state and bounds as the window API reports them, so driver flows (which never show windows) can check
 * frames at exact times of the virtual clock, and each animation's and close's result.
 */
export const FEATURES: readonly WindowChoreographyFeature[] = ["zoom", "frame", "closeTransition", "attach"];
export const ITEMS = ["inbox", "drafts", "archive"] as const;
export type Item = typeof ITEMS[number];
export const WINDOWS = ["detail", "torn", "inspector", "palette"] as const;
export type ChoreographyWindow = typeof WINDOWS[number];
const id = (window: ChoreographyWindow) => `ks-choreo-${window}`;
const content = (window: ChoreographyWindow, label: string) => ({ id: id(window), component: "main", title: label, props: { windowId: id(window), windowProps: { special: label } } });

/** A window's state: `closed`, or shown/hidden with its display and rounded bounds. */
export type WindowState = { visible: boolean; displayId: string; x: number; y: number; width: number; height: number } | null;
/**
 * `runs` counts deep-link runs and `steps` the steps the latest one finished. `animation` is the latest animation's result
 * (`pending` until it ends) and `close` the latest close's; `attached` each attachment's docking.
 */
export type ChoreographyState = {
  windows: Record<ChoreographyWindow, WindowState>; selected: Item; tornOff: boolean;
  attached: Record<"inspector" | "palette", boolean | null>; animation: "none" | "pending" | "finished" | "interrupted" | "reduced";
  close: "none" | "pending" | "closed" | "interrupted" | "vetoed"; reduceMotion: boolean | null; runs: number; steps: number; error: string | null;
};
let state: ChoreographyState = {
  windows: { detail: null, torn: null, inspector: null, palette: null }, selected: "inbox", tornOff: false,
  attached: { inspector: null, palette: null }, animation: "none", close: "none", reduceMotion: null, runs: 0, steps: 0, error: null,
};
const listeners = new Set<() => void>();
function update(change: Partial<ChoreographyState>) { state = { ...state, ...change }; for (const listener of listeners) listener(); }
const errorText = (error: unknown) => error instanceof SparkError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
const report = (error: unknown) => update({ error: errorText(error) });
export const selectItem = (item: Item) => update({ selected: item });
export const getChoreography = () => state;

async function describe(window: ChoreographyWindow): Promise<WindowState> {
  try {
    const { visible, bounds: { displayId, x, y, width, height } } = await getWindow(id(window));
    return { visible, displayId, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  } catch (error) {
    if (error instanceof SparkError && error.code === "E_NOT_FOUND") return null;
    throw error;
  }
}
// The latest refresh wins: an earlier read that resolves late never overwrites it.
let refreshes = 0;
export async function refresh() {
  const ticket = ++refreshes;
  const values = await Promise.all(WINDOWS.map(describe));
  if (ticket === refreshes) update({ windows: Object.fromEntries(WINDOWS.map((window, index) => [window, values[index]])) as ChoreographyState["windows"] });
}
export const refreshNow = () => { refresh().catch(report); };

// The screen registers the list rows and the notes panel slot; zooms start from where they are in the main window.
const sources = new Map<string, RefObject<View | null>>();
export function registerSource(name: string, ref: RefObject<View | null>) { sources.set(name, ref); return () => { if (sources.get(name) === ref) sources.delete(name); }; }
function measure(name: string): Promise<WindowContentRect> {
  const view = sources.get(name)?.current;
  if (!view) return Promise.reject(new Error(`${name} is not on screen`));
  return new Promise(resolve => view.measureInWindow((x, y, width, height) => resolve({ windowId: "main", x, y, width, height })));
}
async function primary() {
  const found = (await getDisplays()).find(display => display.primary);
  if (!found) throw new Error("No primary display");
  return found.id;
}

// Animations and closes are tracked, not awaited, so a step returns while the window is still moving: on the virtual
// clock a flow advances time, refreshes the readout and reads the frame.
// The readout shows the latest animation's result: an earlier one that ends later (interrupted by it) does not replace it.
let animations = 0;
function track(animation: Promise<WindowAnimationResult>) {
  const ticket = ++animations;
  update({ animation: "pending" });
  animation.then(({ finished, reducedMotion }) => { if (ticket === animations) update({ animation: !finished ? "interrupted" : reducedMotion ? "reduced" : "finished" }); }).catch(report).finally(refreshNow);
}
function closing(window: ChoreographyWindow, after?: (result: CloseResult) => void) {
  update({ close: "pending" });
  closeWindow(id(window)).then(result => { update({ close: result.closed ? "closed" : result.reason }); after?.(result); }).catch(report).finally(refreshNow);
}
const LINEAR = { durationMs: 300, easing: "linear" } as const;
type Source = Parameters<typeof openWindowFrom>[1]["from"];
const zoomOpen = async (window: ChoreographyWindow, label: string, from: Source | Promise<Source>, options: { linear?: boolean; closeBack?: boolean } = {}) => {
  const zoom = await openWindowFrom({ ...content(window, label), size: { width: 400, height: 300 } },
    { from: await from, focusOnClose: "main", transition: options.linear ? LINEAR : { durationMs: 300, easing: "easeOut" }, ...(options.closeBack === false ? { closeTo: null } : {}) });
  track(zoom.finished);
};
const resize = async (width: number, height: number) => {
  const current = await getWindow(id("detail"));
  track(animateWindowBounds(id("detail"), { ...current.bounds, width, height }, LINEAR));
};

// The inspector is a navigator window: its React component reads the selection, so it follows the list.
let navigator: ReturnType<typeof inspectorNavigator> | undefined, inspector: WindowInstance | undefined;
const attachments: Partial<Record<"inspector" | "palette", WindowAttachment>> = {};
function inspectorNavigator() {
  return createWindowsNavigator({ choreoInspector: { component: ChoreographyInspector, id: id("inspector"), options: { title: "Inspector", size: { width: 260, height: 360 } } } }, { onError: event => report(event.error) });
}
// Docks at once (attachWindow resolves when the window is in its docked frame); the magnetic snap back is animated natively.
async function attach(window: "inspector" | "palette", edge: "trailing" | "leading", hideWhenInactive: boolean) {
  const setAttached = (attached: boolean) => update({ attached: { ...state.attached, [window]: attached } });
  attachments[window] = await attachWindow(id(window), "main", { edge, gap: 8, hideWhenInactive, transition: { durationMs: 0 }, onChange: ({ attached }) => setAttached(attached), onError: report });
  setAttached(attachments[window]!.attached);
}
const near = async (window: ChoreographyWindow, dx: number) => {
  const { bounds } = await getWindow(id(window));
  await setWindowBounds(id(window), { ...bounds, x: bounds.x + dx });
};

const STEPS: Record<string, () => Promise<unknown>> = {
  // Out of the selected list row, and back into it when it closes.
  "zoom": async () => zoomOpen("detail", `Detail: ${state.selected}`, measure(`row-${state.selected}`)),
  // Out of a 40 × 30 thumbnail at 0,57 of the primary display, linear, so a flow can check frames halfway.
  "zoom-thumb": async () => zoomOpen("detail", "Detail: thumbnail", { displayId: await primary(), x: 0, y: 57, width: 40, height: 30 }, { linear: true }),
  "close": async () => closing("detail"),
  "stop": () => stopWindowAnimation(id("detail")),
  "compact": () => resize(400, 300),
  "full": () => resize(720, 480),
  "pane-general": () => resize(560, 320),
  "pane-advanced": () => resize(560, 520),
  "tear-off": async () => { await zoomOpen("torn", "Notes", measure("panel"), { closeBack: false }); update({ tornOff: true }); },
  // The torn-off window shrinks back into the panel's slot where it is now, handing focus to the main window, and the
  // panel returns once it has closed.
  "merge": async () => {
    await setWindowCloseTransition(id("torn"), { to: await measure("panel"), focus: "main", transition: LINEAR });
    closing("torn", result => { if (result.closed) update({ tornOff: false }); });
  },
  "inspector": async () => {
    inspector = await (navigator ??= inspectorNavigator()).openInstance("choreoInspector");
    await attach("inspector", "trailing", false);
  },
  "palette": async () => {
    await openWindow({ ...content("palette", "Palette"), size: { width: 200, height: 300 } });
    await attach("palette", "leading", true);
  },
  // A move 12 points off the docked frame snaps back; one 200 points off undocks the palette.
  "palette-nudge": () => near("palette", -12),
  "palette-away": () => near("palette", -200),
  "palette-back": () => near("palette", 196),
  // Puts the main window at a known frame on the primary display, so flows can check where attached windows dock.
  "main-place": async () => setWindowBounds("main", { displayId: await primary(), x: 220, y: 100, width: 1000, height: 700 }),
  "select-drafts": async () => selectItem("drafts"),
  "select-archive": async () => selectItem("archive"),
};

/** Closes every window this screen opened, without transitions. */
async function closeAll() {
  for (const window of ["inspector", "palette"] as const) { await attachments[window]?.remove(); delete attachments[window]; }
  const results = await Promise.allSettled(WINDOWS.map(async window => {
    try { await setWindowCloseTransition(id(window), null); await closeWindow(id(window)); }
    catch (error) { if (!(error instanceof SparkError && error.code === "E_NOT_FOUND")) throw error; }
  }));
  inspector = undefined;
  update({ tornOff: false, attached: { inspector: null, palette: null }, animation: "none", close: "none", selected: "inbox" });
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
}

/** Runs steps in order from a fresh start, or after the open windows with a first step `keep`. A failing step shows its error; later steps still run. */
export async function runSteps(steps: readonly string[]) {
  if (steps[0] !== "keep") await closeAll().catch(report);
  update({ runs: state.runs + 1, steps: 0, error: null });
  for (const [index, name] of steps.entries()) {
    if (name !== "keep") try { await STEPS[name]!(); } catch (error) { report(error); }
    await refresh().catch(report);
    update({ steps: index + 1 });
  }
}
/** A button: one step, keeping the other windows. */
export async function runStep(name: string) {
  update({ error: null });
  try { await STEPS[name]!(); } catch (error) { report(error); } finally { await refresh().catch(report); }
}
export const closeAllWindows = async () => { try { await closeAll(); } catch (error) { report(error); } finally { await refresh().catch(report); } };

export function availability(feature: WindowChoreographyFeature) {
  const result = getWindowChoreographyAvailability(feature);
  return result.available ? "available" : result.reason;
}

/** `spark-ks://multiwindow/choreography?run=<step>,<step>…` (first step `keep`: keep the open windows), or null for any other URL. */
export function parseRunLink(url: string): string[] | null {
  const run = /^spark-ks:\/\/multiwindow\/choreography\?(.*)$/i.exec(url)?.[1]?.split("&").find(pair => pair.startsWith("run="))?.slice(4);
  if (run === undefined) return null;
  const steps = run.split(",").filter(Boolean);
  for (const [index, name] of steps.entries()) if (!STEPS[name] && !(name === "keep" && index === 0)) throw new Error(`Unknown window choreography step: ${name}`);
  return steps;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useChoreographyState() { return useSyncExternalStore(subscribe, () => state); }
export function useWindowChoreography() {
  useRunLinks();
  useReduceMotionEvents();
  return useChoreographyState();
}
/** The Reduce Motion setting, read again after each accessibility display change (null before the first change). */
function useReduceMotionEvents() {
  useEffect(() => {
    const registration = onSystemEvent(() => { getAppearancePreferences().then(({ reduceMotion }) => update({ reduceMotion })).catch(report); }, { types: ["accessibilityDisplayChanged"], onError: report });
    registration.catch(report);
    return () => { registration.then(item => item.remove()).catch(report); };
  }, []);
}
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
