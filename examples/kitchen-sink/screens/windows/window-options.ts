import { useCallback, useEffect, useState } from "react";
import * as links from "@legendapp/spark/links";
import { closeWindow, getWindowAvailability, openWindow, setWindowOptions, type WindowOption, type WindowUpdateOptions } from "@legendapp/spark/windows";
import { SparkError } from "@legendapp/spark/contracts";
import { Platform } from "react-native";

// The child is a secondary root of this bundle; App renders windowProps.message for it.
export const CHILD = "windows-window-options-child";
export const WINDOW_OPTIONS: readonly WindowOption[] = ["aspectRatio", "opacity", "contentProtection", "ignoreMouseEvents", "spaces", "simpleFullscreen", "documentEdited", "backgroundMaterial", "subtitle", "trafficLightPosition"];

type Value = { label: string; options: WindowUpdateOptions };
/** One row per option from the Windows epic. `initial` is applied when the child opens; Next cycles through `values`. */
export type Toggle = { id: string; label: string; option?: WindowOption; initial: number; values: readonly Value[] };
const flag = (key: "resizable" | "closable" | "minimizable" | "hasShadow" | "contentProtection" | "ignoreMouseEvents", initial: boolean): Value[] =>
  initial ? [{ label: "on", options: { [key]: true } }, { label: "off", options: { [key]: false } }] : [{ label: "off", options: { [key]: false } }, { label: "on", options: { [key]: true } }];

export const TOGGLES: readonly Toggle[] = [
  { id: "aspect-ratio", label: "Aspect ratio", option: "aspectRatio", initial: 0, values: [{ label: "16:10", options: { aspectRatio: 1.6 } }, { label: "free", options: { aspectRatio: null } }] },
  { id: "resizable", label: "Resizable", initial: 0, values: flag("resizable", true) },
  { id: "closable", label: "Closable", initial: 0, values: flag("closable", true) },
  { id: "minimizable", label: "Minimizable", initial: 0, values: flag("minimizable", true) },
  { id: "size-limits", label: "Min/max size", initial: 0, values: [
    { label: "none", options: { minSize: null, maxSize: null } },
    { label: "400x300 to 900x700", options: { minSize: { width: 400, height: 300 }, maxSize: { width: 900, height: 700 } } },
  ] },
  { id: "level", label: "Level", initial: 0, values: [{ label: "normal", options: { alwaysOnTop: false } }, { label: "floating", options: { alwaysOnTop: true } }] },
  { id: "spaces", label: "Spaces", option: "spaces", initial: 0, values: [
    { label: "default", options: { macos: { spaces: "default" } } }, { label: "all", options: { macos: { spaces: "all" } } }, { label: "active", options: { macos: { spaces: "active" } } },
  ] },
  { id: "opacity", label: "Opacity", option: "opacity", initial: 0, values: [{ label: "1", options: { opacity: 1 } }, { label: "0.6", options: { opacity: 0.6 } }] },
  { id: "background", label: "Background", initial: 0, values: [
    { label: "window", options: { transparent: false } }, { label: "#3366CC", options: { backgroundColor: "#3366CC" } }, { label: "transparent", options: { transparent: true } },
  ] },
  { id: "shadow", label: "Shadow", initial: 0, values: flag("hasShadow", true) },
  { id: "material", label: "Vibrancy", option: "backgroundMaterial", initial: 0, values: [
    { label: "none", options: { macos: { backgroundMaterial: "none" } } }, { label: "sidebar", options: { macos: { backgroundMaterial: "sidebar" } } }, { label: "hudWindow", options: { macos: { backgroundMaterial: "hudWindow" } } },
  ] },
  { id: "content-protection", label: "Content protection", option: "contentProtection", initial: 0, values: flag("contentProtection", false) },
  { id: "click-through", label: "Click-through", option: "ignoreMouseEvents", initial: 0, values: flag("ignoreMouseEvents", false) },
  { id: "simple-fullscreen", label: "Simple fullscreen", option: "simpleFullscreen", initial: 0, values: [
    { label: "off", options: { macos: { simpleFullscreen: false } } }, { label: "on", options: { macos: { simpleFullscreen: true } } },
  ] },
  { id: "traffic-lights", label: "Traffic-light position", option: "trafficLightPosition", initial: 1, values: [
    { label: "AppKit", options: { macos: { titleBar: { trafficLightPosition: null } } } }, { label: "20, 18", options: { macos: { titleBar: { trafficLightPosition: { x: 20, y: 18 } } } } },
  ] },
  // Overlay shows the traffic-light position over the content; Windows has no overlay title bar.
  { id: "title-bar", label: "Title bar style", initial: Platform.OS === "macos" ? 1 : 0, values: (["default", "overlay", "hidden", "borderless"] as const).map(style => ({ label: style, options: { titleBarStyle: style } })) },
  { id: "toolbar", label: "Toolbar style", initial: 0, values: [
    { label: "none", options: { macos: { toolbar: { visible: false } } } },
    { label: "unified", options: { macos: { toolbar: { visible: true, style: "unified" } } } },
    { label: "unifiedCompact", options: { macos: { toolbar: { visible: true, style: "unifiedCompact" } } } },
  ] },
  { id: "subtitle", label: "Subtitle", option: "subtitle", initial: 1, values: [{ label: "none", options: { macos: { titleBar: { subtitle: "" } } } }, { label: "Draft", options: { macos: { titleBar: { subtitle: "Draft" } } } }] },
  { id: "represented-file", label: "Represented file", initial: 0, values: [
    { label: "none", options: { macos: { representedUri: null } } }, { label: "/Applications", options: { macos: { representedUri: "file:///Applications/" } } },
  ] },
  { id: "edited", label: "Edited dot", option: "documentEdited", initial: 1, values: [{ label: "no", options: { macos: { documentEdited: false } } }, { label: "yes", options: { macos: { documentEdited: true } } }] },
];

type Options = Record<string, unknown>;
const record = (value: unknown): value is Options => !!value && typeof value === "object" && !Array.isArray(value);
function merge(target: Options, source: Options): Options {
  for (const [key, value] of Object.entries(source)) target[key] = record(value) && record(target[key]) ? merge({ ...target[key] }, value) : value;
  return target;
}
/** macOS-group rows apply only on macOS; the other platform-specific rows only where their option is available. */
const supported = (toggle: Toggle) => toggle.option ? getWindowAvailability(toggle.option).available : Platform.OS === "macos" || !toggle.values.some(value => "macos" in value.options);

/** Opening applies every supported row's initial value, so the child starts in a known, non-default state. */
export function openOptions(): WindowUpdateOptions {
  return TOGGLES.filter(supported).reduce<Options>((options, toggle) => merge(options, toggle.values[toggle.initial]!.options as Options), {}) as WindowUpdateOptions;
}

export function availabilityLines() {
  return WINDOW_OPTIONS.map(option => {
    const availability = getWindowAvailability(option);
    return { option, text: `${option}: ${availability.available ? "available" : availability.reason}` };
  });
}

// Requests that must reject with a typed SparkError before any native change.
const PROBES: readonly { name: string; code: string; options: WindowUpdateOptions }[] = Platform.OS === "macos" ? [
  { name: "opacity 2", code: "E_INVALID_ARGUMENT", options: { opacity: 2 } },
  { name: "aspectRatio 0", code: "E_INVALID_ARGUMENT", options: { aspectRatio: 0 } },
  { name: "spaces every", code: "E_INVALID_ARGUMENT", options: { macos: { spaces: "every" as never } } },
  { name: "trafficLightPosition -1", code: "E_INVALID_ARGUMENT", options: { macos: { titleBar: { trafficLightPosition: { x: -1, y: 0 } } } } },
] : [
  { name: "aspectRatio", code: "E_UNSUPPORTED_OPTION", options: { aspectRatio: 1.6 } },
  { name: "opacity", code: "E_UNSUPPORTED_OPTION", options: { opacity: 0.6 } },
  { name: "contentProtection", code: "E_UNSUPPORTED_OPTION", options: { contentProtection: true } },
  { name: "ignoreMouseEvents", code: "E_UNSUPPORTED_OPTION", options: { ignoreMouseEvents: true } },
  { name: "macos group", code: "E_UNSUPPORTED_OPTION", options: { macos: { documentEdited: true } } },
];

/** Resolves to one `<name>: <code>` line per probe; anything other than the expected SparkError throws. */
export async function probeRejections(): Promise<string> {
  const lines: string[] = [];
  for (const { name, code, options } of PROBES) {
    try { await setWindowOptions(CHILD, options); }
    catch (error) {
      if (!(error instanceof SparkError) || error.code !== code) throw error;
      lines.push(`${name}: ${error.code}`);
      continue;
    }
    throw new Error(`${name} was accepted; expected ${code}`);
  }
  return lines.join("\n");
}

type Row = { index: number; error?: string };
const errorText = (error: unknown) => error instanceof SparkError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
const initialRows = () => Object.fromEntries(TOGGLES.map(toggle => [toggle.id, { index: toggle.initial }])) as Record<string, Row>;

/** The child window and the value each row last applied to it. A row changes only once its update resolves. */
export function useWindowOptions() {
  const [status, setStatus] = useState("Open the child window, then change its options.");
  const [rows, setRows] = useState(initialRows);
  const open = useCallback(async () => {
    try {
      await openWindow({ id: CHILD, component: "main", title: "Window Options Child", size: { width: 520, height: 340 }, props: { windowId: CHILD, windowProps: { message: "Opened by Windows > Window options." } }, ...openOptions() });
      setRows(initialRows()); setStatus("Opened child");
    } catch (error) { setStatus(errorText(error)); }
  }, []);
  const close = useCallback(() => { closeWindow(CHILD).then(result => setStatus(result.closed ? "Closed child" : "Close vetoed"), error => setStatus(errorText(error))); }, []);
  const apply = useCallback(async (toggle: Toggle, index: number) => {
    try { await setWindowOptions(CHILD, toggle.values[index]!.options); setRows(latest => ({ ...latest, [toggle.id]: { index } })); }
    catch (error) { setRows(latest => ({ ...latest, [toggle.id]: { index: latest[toggle.id]!.index, error: errorText(error) } })); }
  }, []);
  const next = useCallback((toggle: Toggle, current: number) => { void apply(toggle, (current + 1) % toggle.values.length); }, [apply]);
  useChildLink(open, apply, setStatus);
  return { status, rows, open, close, next };
}

/**
 * `spark-ks://windows/window-options?child=open&next=<row>,<row>` opens the child and advances
 * the listed rows once each, in order, so the child can be captured in a given state without input.
 */
export function parseChildLink(url: string): string[] | null {
  const query = /^spark-ks:\/\/windows\/window-options\?(.*)$/i.exec(url)?.[1];
  const params = new Map((query ?? "").split("&").map(pair => [pair.split("=")[0]!, pair.split("=")[1] ?? ""] as const));
  if (params.get("child") !== "open") return null;
  const ids = params.get("next")?.split(",").filter(Boolean) ?? [];
  for (const id of ids) if (!TOGGLES.some(toggle => toggle.id === id)) throw new Error(`Unknown window option row: ${id}`);
  return ids;
}

function useChildLink(open: () => Promise<void>, apply: (toggle: Toggle, index: number) => Promise<void>, report: (status: string) => void) {
  useEffect(() => {
    const subscription = links.addEventListener("url", ({ url }) => {
      let ids: string[] | null;
      try { ids = parseChildLink(url); } catch (error) { report(errorText(error)); return; }
      if (!ids) return;
      void (async () => {
        await open();
        const indexes = initialRows();
        for (const id of ids) {
          const toggle = TOGGLES.find(candidate => candidate.id === id)!;
          indexes[id] = { index: (indexes[id]!.index + 1) % toggle.values.length };
          await apply(toggle, indexes[id]!.index);
        }
      })();
    });
    return () => subscription.remove();
  }, [open, apply, report]);
}
