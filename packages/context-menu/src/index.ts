import { Platform } from "react-native";
import NativeContextMenu from "./NativeContextMenu";
import { SparkError, invokeNative, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { menuItems, selectableMenuIds, type MenuItem as SharedMenuItem, type MenuAction as SharedMenuAction } from "@legendapp/spark-desktop-app/src/contracts/menu";
type ContextMenuEntry = { id: string; label: string; disabled?: boolean; hidden?: boolean };
export type MenuItem = { type: "separator" } | (ContextMenuEntry & { type: "action" }) | (ContextMenuEntry & { type: "checkbox"; checked: boolean });
export type MenuAction = Extract<SharedMenuAction, { type: "action" }>;
export type { MenuIcon } from "@legendapp/spark-desktop-app/src/contracts/menu";
export interface ContextMenuOptions { items: readonly MenuItem[]; windowId: string; position: { x: number; y: number } }
export type ContextMenuResult = { canceled: true } | { canceled: false; itemId: string };
export function getContextMenuAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return NativeContextMenu ? { available: true } : { available: false, reason: "missing-module" };
}
/** Owner-content logical coordinates. Empty menus cancel; missing owners reject. */
export async function showContextMenu(options: ContextMenuOptions): Promise<ContextMenuResult> {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected context menu options");
  for (const key of Object.keys(options)) if (!["items", "windowId", "position"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported context menu option: ${key}`);
  if (typeof options.windowId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(options.windowId)) throw new SparkError("E_INVALID_ARGUMENT", "Expected an owner windowId");
  if (!options.position || typeof options.position !== "object" || Object.keys(options.position).some(key => key !== "x" && key !== "y") || !Number.isFinite(options.position.x) || !Number.isFinite(options.position.y) || Math.abs(options.position.x) > 1000000 || Math.abs(options.position.y) > 1000000) throw new SparkError("E_INVALID_ARGUMENT", "Menu position must be finite logical coordinates within one million units");
  const availability = getContextMenuAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Context menus are unavailable");
  const items = menuItems(options.items, { types: ["action", "checkbox", "separator"] }, Platform.OS === "windows" ? "windows" : "macos");
  const ids = selectableMenuIds(items);
  const result = await invokeNative(() => NativeContextMenu!.showMenu(JSON.stringify(items), JSON.stringify({ ...options.position, windowId: options.windowId })));
  if (result === "") return { canceled: true };
  if (typeof result !== "string" || !ids.has(result)) throw new SparkError("E_INVALID_DATA", "Context menu returned an unknown or disabled item");
  return { canceled: false, itemId: result };
}
