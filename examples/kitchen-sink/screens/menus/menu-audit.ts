import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";
import { createMenu, getMenuAvailability, useMenu, type MenuFeature, type MenuOptions, type MenuRootItem } from "@legendapp/spark/menus";
import { SparkError } from "@legendapp/spark/contracts";
import { eventEntry, type Entry } from "../../EventResults";

const mac = Platform.OS === "macos";
export const MENU_FEATURES: readonly MenuFeature[] = ["alternates", "lifecycle", "helpSearch", "mixedState", "icons", "hiddenItems"];

// Each platform gets only what it supports; unsupported options are exercised by the probes below.
const items: MenuRootItem[] = [{
  type: "submenu", id: "audit-menu", label: "Menu Audit", items: mac ? [
    { type: "action", id: "close-sample", label: "Close Sample", shortcut: "Cmd+Shift+J" },
    { type: "action", id: "close-all-samples", label: "Close All Samples", shortcut: "Cmd+Alt+Shift+J", alternate: true },
    { type: "checkbox", id: "mixed-selection", label: "Mixed selection", checked: "mixed" },
    { type: "action", id: "hidden-sample", label: "Hidden sample", hidden: true },
    { type: "action", id: "starred-sample", label: "Starred sample", icon: { type: "symbol", name: "star.fill" } },
  ] : [
    { type: "action", id: "close-sample", label: "Close Sample", shortcut: "Ctrl+Shift+J" },
    { type: "checkbox", id: "checked-selection", label: "Checked selection", checked: true },
    { type: "action", id: "hidden-sample", label: "Hidden sample", hidden: true },
  ],
}, { type: "submenu", id: "audit-help", label: "Help", target: { menu: "help" }, items: [{ type: "action", id: "audit-guide", label: "Menu Audit Guide" }] }];

const probeRoot = (leaf: MenuRootItem["items"]): MenuRootItem[] => [{ type: "submenu", id: "probe-root", label: "Probe", items: leaf }];
const probe = { type: "action", id: "probe", label: "Probe", shortcut: "Cmd+Alt+K" } as const;
// Requests that must reject with a typed SparkError before any native change.
const PROBES: readonly { name: string; code: string; options: Omit<MenuOptions, "id"> }[] = mac ? [
  { name: "alternate without a primary", code: "E_INVALID_ARGUMENT", options: { items: probeRoot([{ ...probe, alternate: true }]) } },
  { name: "alternate with the primary's modifiers", code: "E_INVALID_ARGUMENT", options: { items: probeRoot([{ ...probe, id: "primary" }, { ...probe, alternate: true }]) } },
  { name: "alternate with another key", code: "E_INVALID_ARGUMENT", options: { items: probeRoot([{ ...probe, id: "primary", shortcut: "Cmd+L" }, { ...probe, alternate: true }]) } },
] : [
  { name: "alternates", code: "E_UNSUPPORTED_OPTION", options: { items: probeRoot([{ type: "action", id: "primary", label: "Primary" }, { type: "action", id: "probe", label: "Probe", alternate: true }]) } },
  { name: "mixedState", code: "E_UNSUPPORTED_OPTION", options: { items: probeRoot([{ type: "checkbox", id: "probe", label: "Probe", checked: "mixed" }]) } },
  { name: "icons", code: "E_UNSUPPORTED_OPTION", options: { items: probeRoot([{ type: "action", id: "probe", label: "Probe", icon: { type: "symbol", name: "star" } }]) } },
  { name: "lifecycle", code: "E_UNSUPPORTED_OPTION", options: { items: probeRoot([]), onOpen() {} } },
];

/** One line per feature: `<feature>: available` or `<feature>: <reason>`. */
export function menuAvailabilityLines() {
  return MENU_FEATURES.map(feature => {
    const availability = getMenuAvailability(feature);
    return { feature, text: `${feature}: ${availability.available ? "available" : availability.reason}` };
  });
}

/** Resolves to one `<name>: <code>` line per probe; anything other than the expected SparkError throws. */
export async function probeRejections(): Promise<string> {
  const lines: string[] = [];
  for (const { name, code, options } of PROBES) {
    let menu;
    try { menu = await createMenu({ id: "menus-audit-probe", ...options }); }
    catch (error) {
      if (!(error instanceof SparkError) || error.code !== code) throw error;
      lines.push(`${name}: ${error.code}`);
      continue;
    }
    await menu.remove();
    throw new Error(`${name} was accepted; expected ${code}`);
  }
  return lines.join("\n");
}

/** Installs the audit menu for the screen's lifetime and records its native callbacks. */
export function useMenuAudit() {
  const [events, setEvents] = useState<readonly Entry[]>([]);
  const sequence = useRef(0);
  const record = useCallback((text: string) => { const entry = eventEntry(++sequence.current, text); setEvents(previous => [...previous.slice(-7), entry]); }, []);
  const state = useMenu({
    id: "menus-audit", items, onAction: event => record(`Action ${event.itemId}`),
    ...(mac ? { onOpen: ({ menuId }: { menuId: string }) => record(`Opened ${menuId}`), onClose: ({ menuId }: { menuId: string }) => record(`Closed ${menuId}`) } : {}),
  });
  return { state, events };
}
