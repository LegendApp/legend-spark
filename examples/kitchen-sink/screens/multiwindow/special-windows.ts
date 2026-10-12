import { useEffect, useSyncExternalStore } from "react";
import * as links from "@legendapp/spark/links";
import { SparkError } from "@legendapp/spark/contracts";
import {
  addWindowListener, closeWindow, createCommandBar, createEdgeDrawer, createHUD, getDisplays, getSpecialWindowAvailability, getWindow, openDesktopWidget, openOverlay, openPictureInPicture,
  openPopover, openPreviewWindow, setWindowBounds, startPresenterMode, type AsyncRegistration, type CommandBar, type EdgeDrawer, type HUD, type PictureInPicture, type Popover,
  type PresenterMode, type PreviewWindow, type ScreenCorner, type SpecialWindowType,
} from "@legendapp/spark/windows";

/**
 * Multiwindow > Special windows: one of each special window type (docs/api-window-contract.md#special-window-types).
 * Every window shows this bundle's secondary root with a label. The readout lists each window's state and bounds as the
 * window API reports them, so driver flows (which never show windows) can check placement.
 */
export const TYPES: readonly SpecialWindowType[] = ["commandBar", "hud", "preview", "pictureInPicture", "popover", "edgeDrawer", "overlay", "desktopWidget", "presenter"];
export const HOTKEY = "Cmd+Shift+Space";
/** Readout rows: window ID suffix → label. */
export const ROWS = [["bar", "Command bar"], ["hud", "HUD"], ["preview", "Preview"], ["pip", "Picture in picture"], ["popover", "Popover"], ["drawer", "Edge drawer"],
  ["overlay", "Overlay"], ["widget", "Desktop widget"], ["audience", "Presenter audience"], ["controller", "Presenter controller"]] as const;
type Row = typeof ROWS[number][0];
const id = (row: Row) => `ks-special-${row}`;
const content = (row: Row, label: string) => ({ id: id(row), component: "main", title: label, props: { windowId: id(row), windowProps: { special: label } } });

/** `runs` counts deep-link runs and `steps` the steps the latest one finished, so a flow can tell one run from the next. */
export type SpecialWindowsState = { rows: Record<Row, string>; presenter: string; runs: number; steps: number; error: string | null };
const initialRows = () => Object.fromEntries(ROWS.map(([row]) => [row, "closed"])) as Record<Row, string>;
let state: SpecialWindowsState = { rows: initialRows(), presenter: "off", runs: 0, steps: 0, error: null };
const listeners = new Set<() => void>();
function update(change: Partial<SpecialWindowsState>) { state = { ...state, ...change }; for (const listener of listeners) listener(); }
const errorText = (error: unknown) => error instanceof SparkError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
const report = (error: unknown) => update({ error: errorText(error) });

/** `shown on <display> at x,y size WxH`, `hidden …`, or `closed`. */
async function describe(row: Row) {
  try {
    const { visible, bounds: { displayId, x, y, width, height } } = await getWindow(id(row));
    return `${visible ? "shown" : "hidden"} on ${displayId} at ${Math.round(x)},${Math.round(y)} size ${Math.round(width)}x${Math.round(height)}`;
  } catch (error) {
    if (error instanceof SparkError && error.code === "E_NOT_FOUND") return "closed";
    throw error;
  }
}
// The latest refresh wins: an earlier read that resolves late never overwrites it.
let refreshes = 0;
async function refresh() {
  const ticket = ++refreshes;
  const values = await Promise.all(ROWS.map(([row]) => describe(row)));
  if (ticket === refreshes) update({ rows: Object.fromEntries(ROWS.map(([row], index) => [row, values[index]])) as Record<Row, string> });
}
const refreshNow = () => { refresh().catch(report); };
/** Refreshes the readout whenever the window moves, shows, hides or closes (a HUD hides itself, a blurred popover closes). */
async function track(row: Row) {
  const registrations: AsyncRegistration[] = [];
  const closed = () => { refreshNow(); for (const registration of registrations) registration.remove().catch(report); };
  for (const type of ["boundsChanged", "visibilityChanged"] as const) registrations.push(await addWindowListener(id(row), type, refreshNow, { onError: report }));
  registrations.push(await addWindowListener(id(row), "closed", closed, { onError: report }));
}

let bar: CommandBar | undefined, hud: HUD | undefined, preview: PreviewWindow | undefined, pip: PictureInPicture | undefined, popover: Popover | undefined, drawer: EdgeDrawer | undefined, presenter: PresenterMode | undefined;
const SIZE = { width: 640, height: 120 };
const need = <T>(value: T | undefined, name: string): T => { if (!value) throw new Error(`Open the ${name} first`); return value; };

const STEPS: Record<string, () => Promise<unknown>> = {
  "bar": async () => { bar = await createCommandBar({ ...content("bar", "Command bar"), size: SIZE, hotkey: HOTKEY, onError: report }); await track("bar"); },
  "bar-toggle": () => need(bar, "command bar").toggle(),
  "bar-remove": async () => { await need(bar, "command bar").remove(); bar = undefined; },
  "hud": async () => { hud = await createHUD({ ...content("hud", "Volume 60%"), size: { width: 200, height: 200 } }); await track("hud"); await hud.show({ durationMs: 1500 }); },
  "hud-hold": () => need(hud, "HUD").show({ durationMs: 0 }),
  "hud-hide": () => need(hud, "HUD").hide(),
  // A thumbnail near the primary display's top-left corner.
  "preview": async () => { preview = await openPreviewWindow({ ...content("preview", "Preview of photo.jpg"), size: { width: 800, height: 600 }, from: { displayId: await primaryId(), x: 40, y: 80, width: 64, height: 48 } }); await track("preview"); },
  "preview-close": async () => { await need(preview, "preview").close(); preview = undefined; },
  "pip": async () => { pip = await openPictureInPicture({ ...content("pip", "Picture in picture"), size: { width: 320, height: 180 } }); await track("pip"); },
  // Moves it near the middle of the primary display: corner snapping puts it in the nearest corner (top left).
  "pip-move": async () => { need(pip, "picture-in-picture window"); await setWindowBounds(id("pip"), { displayId: await primaryId(), x: 300, y: 200, width: 320, height: 180 }); },
  ...Object.fromEntries((["topLeft", "topRight", "bottomLeft", "bottomRight"] as ScreenCorner[]).map(corner => [`pip-${corner}`, () => need(pip, "picture-in-picture window").snapTo(corner)])),
  "pip-close": async () => { await need(pip, "picture-in-picture window").close(); pip = undefined; },
  "popover-notch": async () => { popover = await openPopover({ ...content("popover", "Notch popover"), size: { width: 360, height: 220 }, anchor: { type: "notch" } }); await track("popover"); },
  // A 24-point menu bar item 300 points from the primary display's right edge, as Tray.getBounds() reports one.
  "popover-item": async () => {
    const display = await primaryId(), width = await primaryWidth();
    popover = await openPopover({ ...content("popover", "Tray popover"), size: { width: 360, height: 220 }, anchor: { type: "rect", rect: { displayId: display, x: width - 300, y: 0, width: 24, height: 24 } } });
    await track("popover");
  },
  "popover-close": async () => { await need(popover, "popover").close(); popover = undefined; },
  "drawer": async () => { drawer = await createEdgeDrawer({ ...content("drawer", "Edge drawer"), edge: "right", thickness: 320 }); await track("drawer"); },
  "drawer-toggle": () => need(drawer, "edge drawer").toggle(),
  "drawer-remove": async () => { await need(drawer, "edge drawer").remove(); drawer = undefined; },
  "overlay": async () => { await openOverlay({ ...content("overlay", "Click-through overlay"), rect: { displayId: await primaryId(), x: 100, y: 100, width: 400, height: 300 } }); await track("overlay"); },
  "overlay-close": () => closeWindow(id("overlay")),
  "widget": async () => { await openDesktopWidget({ ...content("widget", "Desktop widget"), size: { width: 200, height: 200 }, position: { displayId: await primaryId(), x: 40, y: 80 }, material: "popover" }); await track("widget"); },
  "widget-close": () => closeWindow(id("widget")),
  "presenter": async () => {
    presenter = await startPresenterMode({ audience: content("audience", "Audience: slide 1"), controller: content("controller", "Presenter notes"), onEnd: ({ reason }) => { presenter = undefined; update({ presenter: `ended: ${reason}` }); } });
    await Promise.all([track("audience"), track("controller")]);
    update({ presenter: `audience on ${presenter.audienceDisplayId}, controller on ${presenter.controllerDisplayId}` });
  },
  "presenter-swap": async () => { const mode = need(presenter, "presenter mode"); await mode.swapDisplays(); update({ presenter: `audience on ${mode.audienceDisplayId}, controller on ${mode.controllerDisplayId}` }); },
  "presenter-stop": () => need(presenter, "presenter mode").stop(),
};
async function primary() {
  const found = (await getDisplays()).find(display => display.primary);
  if (!found) throw new Error("No primary display");
  return found;
}
const primaryId = async () => (await primary()).id;
const primaryWidth = async () => (await primary()).size.width;

/** Closes every special window this screen opened. */
async function closeAll() {
  const results = await Promise.allSettled([bar?.remove(), hud?.remove(), drawer?.remove(), presenter?.stop(), preview?.close(), pip?.close(), popover?.close(),
    ...(["overlay", "widget"] as const).map(row => closeWindow(id(row)).catch(error => { if (!(error instanceof SparkError && error.code === "E_NOT_FOUND")) throw error; }))]);
  bar = hud = drawer = presenter = preview = pip = popover = undefined;
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected" && !(result.reason instanceof SparkError && result.reason.code === "E_CLOSED"));
  if (failed) throw failed.reason;
}

export const STEP_NAMES = Object.keys(STEPS);
/** Runs steps in order from a fresh start. A step that rejects shows its error; later steps still run. */
export async function runSteps(steps: readonly string[]) {
  await closeAll();
  update({ runs: state.runs + 1, steps: 0, error: null, presenter: "off" });
  for (const [index, name] of steps.entries()) {
    try { await STEPS[name]!(); } catch (error) { report(error); }
    await refresh();
    update({ steps: index + 1 });
  }
}
/** A button: one step, without closing the other windows first. */
export async function runStep(name: string) {
  update({ error: null });
  try { await STEPS[name]!(); } finally { await refresh(); }
}
export const closeAllWindows = async () => { try { await closeAll(); } finally { await refresh(); update({ presenter: "off" }); } };

export function availability(type: SpecialWindowType) {
  const result = getSpecialWindowAvailability(type);
  return result.available ? "available" : result.reason;
}

/** `spark-ks://multiwindow/special-windows?run=<step>,<step>…`: the steps to run, or null for any other URL. */
export function parseRunLink(url: string): string[] | null {
  const query = /^spark-ks:\/\/multiwindow\/special-windows\?(.*)$/i.exec(url)?.[1];
  const run = query?.split("&").find(pair => pair.startsWith("run="))?.slice(4);
  if (run === undefined) return null;
  const steps = run.split(",").filter(Boolean);
  for (const name of steps) if (!STEPS[name]) throw new Error(`Unknown special window step: ${name}`);
  return steps;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useSpecialWindows() {
  useRunLinks();
  return useSyncExternalStore(subscribe, () => state);
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
