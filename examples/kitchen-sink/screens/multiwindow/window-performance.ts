import { useEffect, useSyncExternalStore } from "react";
import * as links from "@legendapp/spark/links";
import { SparkError } from "@legendapp/spark/contracts";
import {
  createWindowsNavigator, getWindowPerformanceAvailability, hideWindow, showWindow, type WindowInstance, type WindowPerformanceFeature, type WindowPoolState, type WindowsNavigator,
} from "@legendapp/spark/windows";
import { PerformanceClock, PerformanceNote } from "./PerformanceWindows";
import { advanceClock, getClock, resetClock, takeCommit } from "./performance-store";

/**
 * Multiwindow > Window performance (docs/api-window-contract.md#window-pools): a pooled note entry next to the same
 * note without a pool, a pool whose 1 MB budget holds no window, and a throttled clock window. The readout shows each
 * pool's state, how long the last warm and cold opens took to their first paint, and how often the clock rendered.
 * Driven runs never show these windows; times are from the open call to the content's first commit with the window shown.
 */
export const FEATURES: readonly WindowPerformanceFeature[] = ["pool", "throttle"];
const NOTE_OPTIONS = { size: { width: 480, height: 320 } };

// Created on first use: on platforms without pools the configuration rejects E_UNSUPPORTED_OPTION, shown as the error.
let navigator: WindowsNavigator<ReturnType<typeof config>> | undefined;
function config() {
  return {
    perfPooled: { component: PerformanceNote, options: { ...NOTE_OPTIONS, title: "Pooled note" }, pool: { prewarm: 1, max: 2, memoryBudgetMB: 64 } },
    perfCold: { component: PerformanceNote, options: { ...NOTE_OPTIONS, title: "Cold note" } },
    perfTight: { component: PerformanceNote, options: { ...NOTE_OPTIONS, title: "Tight note" }, pool: { prewarm: 1, max: 2, memoryBudgetMB: 1 } },
    perfClock: { component: PerformanceClock, options: { title: "Throttled clock", size: { width: 320, height: 200 } }, throttle: true },
  } as const;
}
const windows = () => navigator ??= createWindowsNavigator(config(), { onError: event => report(event.error) });

export type Paint = { ms: number; fast: boolean } | null;
/**
 * `runs` counts deep-link runs and `steps` the steps the latest one finished, so a flow can tell one run from the next.
 * `done` is the finished run's `tag`, cleared when the next run starts, for flows that repeat runs (leak checks).
 */
export type PerformanceState = {
  pooled: WindowPoolState | null; tight: WindowPoolState | null; warmPaint: Paint; coldPaint: Paint;
  clock: { value: number; renders: number; shown: boolean } | null; hiddenRenders: number | null; runs: number; steps: number; done: string | null; error: string | null;
};
let state: PerformanceState = { pooled: null, tight: null, warmPaint: null, coldPaint: null, clock: null, hiddenRenders: null, runs: 0, steps: 0, done: null, error: null };
const listeners = new Set<() => void>();
function update(change: Partial<PerformanceState>) { state = { ...state, ...change }; for (const listener of listeners) listener(); }
const errorText = (error: unknown) => error instanceof SparkError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
const report = (error: unknown) => update({ error: errorText(error) });

let notes: WindowInstance[] = [], clock: WindowInstance | undefined, clockShown = false, rendersAtHide = 0, opens = 0;
function refresh() {
  const pools = navigator ? { pooled: navigator.getPool("perfPooled"), tight: navigator.getPool("perfTight") } : { pooled: null, tight: null };
  update({ ...pools, clock: clock?.isOpen() ? { ...getClock(), shown: clockShown } : null });
}
/** Opens a note and measures from the call to the later of its content's first commit and the open resolving (shown). */
async function openNote(name: "perfPooled" | "perfCold"): Promise<Paint> {
  const token = `open-${++opens}`, title = `${name === "perfPooled" ? "Pooled" : "Cold"} ${opens}`;
  const start = performance.now();
  notes.push(await windows().openInstance(name, { props: { title, token }, options: { title } }));
  const shown = performance.now(), committed = takeCommit(token);
  if (committed === undefined) throw new Error("The note opened before its content committed");
  const ms = Math.round(Math.max(shown, committed) - start);
  return { ms, fast: ms < 100 };
}
const need = <T>(value: T | undefined, name: string): T => { if (!value) throw new Error(`Open the ${name} first`); return value; };
const frame = () => new Promise(resolve => setTimeout(resolve, 16));

const STEPS: Record<string, () => Promise<unknown>> = {
  "prewarm": () => windows().prewarm("perfPooled"),
  "warm": async () => update({ warmPaint: await openNote("perfPooled") }),
  "cold": async () => update({ coldPaint: await openNote("perfCold") }),
  "close": async () => { await need(notes.pop(), "note").close(); },
  "trim": () => windows().trimPool(),
  "tight": () => windows().prewarm("perfTight"),
  "clock": async () => { resetClock(); clock = await windows().openInstance("perfClock"); clockShown = true; },
  "clock-hide": async () => { await hideWindow(need(clock, "clock").id); clockShown = false; rendersAtHide = getClock().renders; update({ hiddenRenders: null }); },
  // Five clock changes a frame apart; while hidden, the throttled clock renders none of them.
  "clock-tick": async () => {
    for (let n = 0; n < 5; n++) { advanceClock(); await frame(); }
    if (!clockShown) update({ hiddenRenders: getClock().renders - rendersAtHide });
  },
  "clock-show": async () => { await showWindow(need(clock, "clock").id, { focus: false }); clockShown = true; await frame(); },
  // Lets asynchronous pool work (releases after memory pressure) finish before the readout refreshes.
  "settle": () => new Promise(resolve => setTimeout(resolve, 250)),
};

/** Closes this screen's windows and releases its warm windows. */
async function closeAll() {
  const open = [...notes, ...(clock ? [clock] : [])].filter(window => window.isOpen());
  notes = []; clock = undefined; clockShown = false;
  await Promise.all(open.map(window => window.close()));
  if (navigator) await navigator.trimPool();
}

export const STEP_NAMES = Object.keys(STEPS);
/** Runs steps in order from a fresh start. A step that rejects shows its error; later steps still run. */
export async function runSteps(steps: readonly string[], tag: string | null = null) {
  update({ done: null });
  if (steps[0] !== "keep") await closeAll().catch(report);
  update({ runs: state.runs + 1, steps: 0, error: null, ...(steps[0] === "keep" ? {} : { warmPaint: null, coldPaint: null, hiddenRenders: null }) });
  for (const [index, name] of steps.entries()) {
    if (name !== "keep") try { await STEPS[name]!(); } catch (error) { report(error); }
    refresh();
    update({ steps: index + 1 });
  }
  update({ done: tag });
}
/** A button: one step, keeping the other windows. */
export async function runStep(name: string) {
  update({ error: null });
  try { await STEPS[name]!(); } catch (error) { report(error); } finally { refresh(); }
}
export const closeAllWindows = async () => { try { await closeAll(); } catch (error) { report(error); } finally { refresh(); } };

export function availability(feature: WindowPerformanceFeature) {
  const result = getWindowPerformanceAvailability(feature);
  return result.available ? "available" : result.reason;
}

/**
 * `spark-ks://multiwindow/performance?run=<step>,<step>…[&tag=<tag>]` (first step `keep`: keep the open windows): the
 * steps and tag, or null for any other URL.
 */
export function parseRunLink(url: string): { steps: string[]; tag: string | null } | null {
  const pairs = /^spark-ks:\/\/multiwindow\/performance\?(.*)$/i.exec(url)?.[1]?.split("&");
  const run = pairs?.find(pair => pair.startsWith("run="))?.slice(4);
  if (run === undefined) return null;
  const steps = run.split(",").filter(Boolean);
  for (const [index, name] of steps.entries()) if (!STEPS[name] && !(name === "keep" && index === 0)) throw new Error(`Unknown window performance step: ${name}`);
  return { steps, tag: pairs?.find(pair => pair.startsWith("tag="))?.slice(4) || null };
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useWindowPerformance() {
  useRunLinks();
  return useSyncExternalStore(subscribe, () => state);
}
function useRunLinks() {
  useEffect(() => {
    const subscription = links.addEventListener("url", ({ url }) => {
      let run: ReturnType<typeof parseRunLink>;
      try { run = parseRunLink(url); } catch (error) { report(error); return; }
      if (run) runSteps(run.steps, run.tag).catch(report);
    });
    return () => subscription.remove();
  }, []);
}
