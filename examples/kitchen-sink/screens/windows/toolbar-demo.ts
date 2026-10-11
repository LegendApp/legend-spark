import { useCallback, useEffect, useRef, useState } from "react";
import { closeWindow, getToolbarAvailability, getWindow, openWindow, setWindowBounds, setWindowOptions, type MacOSToolbarDisplayMode, type MacOSToolbarItem, type ToolbarFeature, type WindowUpdateOptions } from "@legendapp/spark/windows";
import { addMacOSWindowListener, getToolbarState, showToolbarCustomizationPalette, type AsyncRegistration, type MacOSToolbarState, type MacOSWindowEvent } from "@legendapp/spark/windows/macos";
import { SparkError } from "@legendapp/spark/contracts";
import { Platform } from "react-native";

// The child is a secondary root of this bundle; App renders windowProps.message for it.
export const CHILD = "windows-toolbar-child";
export const CUSTOMIZATION_ID = "kitchen-sink.toolbar";
export const FEATURES: readonly ToolbarFeature[] = ["customization", "displayMode", "overflow", "shown", "sidebarToggle"];
const ITEMS: readonly MacOSToolbarItem[] = [
  { type: "sidebarToggle", id: "sidebar", placement: "leading" },
  { type: "segmented", id: "view", label: "View", value: "list", segments: [{ value: "list", label: "List", symbol: "list.bullet" }, { value: "grid", label: "Grid", symbol: "square.grid.2x2" }] },
  { type: "menu", id: "sort", label: "Sort", symbol: "arrow.up.arrow.down", items: [{ type: "checkbox", id: "name", label: "Name", checked: true }, { type: "checkbox", id: "date", label: "Date", checked: false }] },
  { type: "button", id: "new", label: "New", symbol: "plus" },
  { type: "button", id: "share", label: "Share", symbol: "square.and.arrow.up" },
];
const WIDE = 900, NARROW = 420;

/** One row per toolbar feature. The child opens with value 0 of every row; Next applies the following value. */
export type Toggle = { id: string; label: string; values: readonly string[] };
export const TOGGLES: readonly Toggle[] = [
  { id: "display-mode", label: "Display mode", values: ["icon", "iconAndLabel", "label"] },
  { id: "shown", label: "Shown", values: ["yes", "no"] },
  { id: "width", label: "Window width", values: [`${WIDE}`, `${NARROW}`] },
  { id: "customization", label: "Customization", values: ["off", CUSTOMIZATION_ID] },
];
function applyRow(id: string, value: string): Promise<void> {
  if (id === "width") return getWindow(CHILD).then(({ bounds }) => setWindowBounds(CHILD, { ...bounds, width: Number(value) }));
  const toolbar = id === "display-mode" ? { displayMode: value as MacOSToolbarDisplayMode }
    : id === "shown" ? { shown: value === "yes" }
    : { customization: value === "off" ? null : { id: value } };
  return setWindowOptions(CHILD, { macos: { toolbar } });
}

export function availabilityLines() {
  return FEATURES.map(feature => {
    const availability = getToolbarAvailability(feature);
    return { feature, text: `${feature}: ${availability.available ? "available" : availability.reason}` };
  });
}

export function stateLines(state: MacOSToolbarState | null) {
  if (!state) return [];
  const list = (ids: string[]) => ids.length ? ids.join(", ") : "none";
  return [
    { id: "shown", text: `shown: ${state.shown ? "yes" : "no"}` },
    { id: "mode", text: `display mode: ${state.displayMode}` },
    { id: "customization", text: `customization: ${state.customizationId ?? "off"}` },
    { id: "items", text: `items: ${list(state.itemIds)}` },
    { id: "overflow", text: `overflow: ${list(state.overflowItemIds)}` },
  ];
}

function describe(event: MacOSWindowEvent): string {
  switch (event.type) {
    case "toolbarAction": return `toolbarAction ${event.itemId}`;
    case "toolbarSelectionChanged": return `toolbarSelectionChanged ${event.itemId}=${event.value}`;
    case "toolbarMenuAction": return `toolbarMenuAction ${event.itemId}/${event.action.itemId}`;
    case "titleBarAction": return `titleBarAction ${event.controlId}`;
    default: return `${event.type} ${event.itemId}="${event.value}"`;
  }
}

// Requests that must reject with a typed SparkError before any native change.
const PROBES: readonly { name: string; code: string; run: () => Promise<unknown> }[] = Platform.OS === "macos" ? [
  { name: "displayMode text", code: "E_INVALID_ARGUMENT", run: () => setWindowOptions(CHILD, { macos: { toolbar: { displayMode: "text" as never } } }) },
  { name: "customization id with a space", code: "E_INVALID_ARGUMENT", run: () => setWindowOptions(CHILD, { macos: { toolbar: { customization: { id: "tool bar" } } } }) },
  { name: "two sidebarToggle items", code: "E_INVALID_ARGUMENT", run: () => setWindowOptions(CHILD, { macos: { toolbar: { items: [{ type: "sidebarToggle", id: "a" }, { type: "sidebarToggle", id: "b" }] } } }) },
  { name: "shown on a removed toolbar", code: "E_INVALID_ARGUMENT", run: () => setWindowOptions(CHILD, { macos: { toolbar: { visible: false, shown: true } } }) },
] : [
  { name: "macos toolbar group", code: "E_UNSUPPORTED_OPTION", run: () => setWindowOptions(CHILD, { macos: { toolbar: { displayMode: "icon" } } } as WindowUpdateOptions) },
  { name: "getToolbarState", code: "E_UNSUPPORTED_PLATFORM", run: () => getToolbarState(CHILD) },
  { name: "showToolbarCustomizationPalette", code: "E_UNSUPPORTED_PLATFORM", run: () => showToolbarCustomizationPalette(CHILD) },
];

/** Resolves to one `<name>: <code>` line per probe; anything other than the expected SparkError throws. */
export async function probeRejections(): Promise<string> {
  const lines: string[] = [];
  for (const { name, code, run } of PROBES) {
    try { await run(); }
    catch (error) {
      if (!(error instanceof SparkError) || error.code !== code) throw error;
      lines.push(`${name}: ${error.code}`);
      continue;
    }
    throw new Error(`${name} was accepted; expected ${code}`);
  }
  return lines.join("\n");
}

const errorText = (error: unknown) => error instanceof SparkError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
const initialRows = () => Object.fromEntries(TOGGLES.map(toggle => [toggle.id, 0])) as Record<string, number>;

/** The child window, its toolbar as AppKit reports it, the value each row last applied and the last toolbar event. */
export function useToolbarDemo() {
  const [status, setStatus] = useState("Open the child window, then change its toolbar.");
  const [rows, setRows] = useState(initialRows);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<MacOSToolbarState | null>(null);
  const [lastEvent, setLastEvent] = useState("none");
  const listener = useRef<AsyncRegistration | null>(null);
  const refresh = useCallback(() => getToolbarState(CHILD).then(setState, error => setStatus(errorText(error))), []);
  const stopListening = useCallback(() => { void listener.current?.remove(); listener.current = null; }, []);
  const open = useCallback(async () => {
    try {
      stopListening();
      await openWindow({ id: CHILD, component: "main", title: "Toolbar Child", size: { width: WIDE, height: 300 }, props: { windowId: CHILD, windowProps: { message: "Opened by Windows > Toolbar." } },
        macos: { toolbar: { visible: true, style: "unified", items: ITEMS, displayMode: "icon" } } });
      listener.current = await addMacOSWindowListener(CHILD, event => setLastEvent(describe(event)));
      setRows(initialRows()); setErrors({}); setStatus("Opened child");
      await refresh();
    } catch (error) { setStatus(errorText(error)); }
  }, [refresh, stopListening]);
  const close = useCallback(() => {
    stopListening();
    closeWindow(CHILD).then(result => { setStatus(result.closed ? "Closed child" : "Close vetoed"); if (result.closed) setState(null); }, error => setStatus(errorText(error)));
  }, [stopListening]);
  const apply = useCallback(async (toggle: Toggle, index: number) => {
    try {
      await applyRow(toggle.id, toggle.values[index]!);
      setRows(latest => ({ ...latest, [toggle.id]: index }));
      setErrors(({ [toggle.id]: _, ...rest }) => rest);
    } catch (error) { setErrors(latest => ({ ...latest, [toggle.id]: errorText(error) })); }
    await refresh();
  }, [refresh]);
  const next = useCallback((toggle: Toggle, current: number) => { void apply(toggle, (current + 1) % toggle.values.length); }, [apply]);
  const customize = useCallback(() => showToolbarCustomizationPalette(CHILD), []);
  useUnmount(stopListening);
  return { status, rows, errors, state, lastEvent, open, close, next, customize, refresh };
}

function useUnmount(cleanup: () => void) {
  useEffect(() => cleanup, [cleanup]);
}
