import { NativeEventEmitter, Platform } from "react-native";
import NativeMenu from "./NativeMenu";
import { SparkError, asyncRegistration, invokeNative, type Availability, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { menuItems, selectableMenuIds, type MenuInputItem, type MenuWireItem, type MenuAction as SharedMenuAction } from "@legendapp/spark-desktop-app/src/contracts/menu";
import { composeWindowsMenus } from "./windows-menus";
type MenuLeaf = Extract<MenuInputItem, { type: "separator" | "action" | "checkbox" | "role" }>;
export type MenuItem = MenuLeaf | (Omit<Extract<MenuInputItem, { type: "submenu" }>, "items"> & { items: readonly MenuItem[] });
export type MenuFeature = "alternates" | "lifecycle" | "helpSearch" | "mixedState" | "icons" | "hiddenItems";
export interface MenuLifecycleEvent { menuId: string }
export type MenuAction = Extract<SharedMenuAction, { type: "action" }>;
export type { MenuIcon, MenuRole, MenuTarget, MenuPlacement, MenuLocation } from "@legendapp/spark-desktop-app/src/contracts/menu";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
export type MenuRootItem = Extract<MenuItem, { type: "submenu" }>;
export interface MenuUpdate { items: readonly MenuRootItem[] }
export interface MenuOptions extends MenuUpdate { id: string; onAction?: (action: MenuAction) => void; onOpen?: (event: MenuLifecycleEvent) => void; onClose?: (event: MenuLifecycleEvent) => void }
export interface Menu extends AsyncRegistration { readonly id: string; update(options: MenuUpdate): Promise<void> }
interface Owner { id: string; token: string; items: MenuWireItem[] }
let owners = new Map<string, Owner>();
let sequence = 0, queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> { const result = queue.then(operation); queue = result.catch(() => {}); return result; }
export function getMenuAvailability(feature?: MenuFeature): Availability {
  if (feature !== undefined && !["alternates", "lifecycle", "helpSearch", "mixedState", "icons", "hiddenItems"].includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown menu feature");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (!NativeMenu) return { available: false, reason: "missing-module" };
  if (Platform.OS === "windows" && feature !== undefined && feature !== "hiddenItems") return { available: false, reason: "host-restriction" };
  return { available: true };
}
function available() {
  const availability = getMenuAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Application menus are unavailable");
}
function applicationItems(input: readonly MenuItem[]): MenuWireItem[] {
  const macos = Platform.OS === "macos";
  const items = menuItems(input, { types: macos ? ["action", "checkbox", "separator", "submenu", "role"] : ["action", "checkbox", "separator", "submenu"], shortcuts: true, targeting: true, icons: macos ? ["symbol", "image"] : [], alternates: macos, mixedState: macos }, macos ? "macos" : "windows");
  validateAlternates(items);
  return items;
}
/** AppKit folds an alternate only into the adjacent visible item with the same key equivalent and different modifiers. */
function validateAlternates(items: readonly MenuWireItem[]) {
  const visible = items.filter(item => !item.hidden);
  for (const item of items) if (item.items) validateAlternates(item.items);
  visible.forEach((item, index) => {
    if (!item.alternate) return;
    const primary = visible[index - 1];
    const invalid = (message: string) => new SparkError("E_INVALID_ARGUMENT", `Alternate menu item ${item.id} ${message}`);
    if (!primary || primary.separator || primary.items || primary.alternate) throw invalid("must directly follow the visible non-alternate command it replaces");
    if (item.target || item.placement || primary.target || primary.placement) throw invalid("and its primary cannot use target or placement");
    if (primary.shortcut?.key !== item.shortcut?.key) throw invalid("must use the same shortcut key as its primary, or neither has a shortcut");
    if (item.shortcut && primary.shortcut?.modifiers === item.shortcut.modifiers) throw invalid("must use different shortcut modifiers from its primary");
  });
}
function submenuIds(items: MenuWireItem[]): Set<string> {
  const ids = new Set<string>();
  function visit(items: MenuWireItem[]) {
    for (const item of items) if (item.items && item.enabled && !item.hidden) {
      if (item.id) ids.add(item.id);
      visit(item.items);
    }
  }
  visit(items); return ids;
}
function snapshot(value: MenuUpdate, token: string, creating = false, lifecycle = false): MenuWireItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", "Expected menu options");
  for (const key of Object.keys(value)) if (!["items", ...(creating ? ["id", "onAction", "onOpen", "onClose"] : [])].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported menu option: ${key}`);
  const items = applicationItems(value.items);
  if (items.some(item => !item.items)) throw new SparkError("E_INVALID_ARGUMENT", "Application menu roots must be submenus");
  function annotate(items: MenuWireItem[]) { for (const item of items) { item._sparkOwner = token; if (item.items) { if (lifecycle) item._sparkLifecycle = true; annotate(item.items); } } }
  annotate(items); return items;
}
async function publish(next: Map<string, Owner>): Promise<void> {
  const menus = Platform.OS === "windows"
    ? composeWindowsMenus(new Map([...next].map(([id, owner]) => [id, owner.items])))
    : [...next.values()].flatMap(owner => owner.items);
  const result = await invokeNative(() => NativeMenu!.publish(JSON.stringify(menus)));
  if (result !== undefined && result !== null) throw new SparkError("E_INVALID_DATA", "Native menu publication returned an unexpected result");
  owners = next;
}
export async function createMenu(options: MenuOptions): Promise<Menu> {
  available();
  const token = `menu-${Date.now()}-${++sequence}`;
  const items = snapshot(options, token, true, Boolean(options?.onOpen || options?.onClose));
  for (const name of ["onAction", "onOpen", "onClose"] as const) {
    if (options[name] !== undefined && typeof options[name] !== "function") throw new SparkError("E_INVALID_ARGUMENT", `Expected ${name} callback`);
  }
  if ((options.onOpen || options.onClose) && Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_OPTION", "Application menus do not support lifecycle callbacks on this platform");
  if (typeof options.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(options.id)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a menu owner id");
  const id = options.id, { onAction, onOpen, onClose } = options;
  let stopped = false, ready = false, ids = selectableMenuIds(items), menus = submenuIds(items);
  const subscription = new NativeEventEmitter(NativeMenu as never).addListener("NativeMenuAction", event => {
    if (ready && !stopped && event && event.ownerId === token && typeof event.itemId === "string" && ids.has(event.itemId)) {
      // All owners share this emitter; one owner's throw must not swallow the other owners' actions.
      try { onAction?.({ type: "action", itemId: event.itemId }); }
      catch (cause) { console.error(new SparkError("E_NATIVE", "Menu action handler failed", { cause })); }
    }
  });
  const lifecycle = onOpen || onClose ? new NativeEventEmitter(NativeMenu as never).addListener("NativeMenuLifecycle", event => {
    if (ready && !stopped && event?.ownerId === token && menus.has(event.itemId) && (event.type === "open" || event.type === "close")) {
      try { (event.type === "open" ? onOpen : onClose)?.({ menuId: event.itemId }); }
      catch (cause) { console.error(new SparkError("E_NATIVE", "Menu lifecycle handler failed", { cause })); }
    }
  }) : undefined;
  function stop() { stopped = true; subscription.remove(); lifecycle?.remove(); }
  try { await serial(async () => {
    if (owners.has(id)) throw new SparkError("E_ALREADY_EXISTS", `Menu owner ${id} already exists`);
    const next = new Map(owners); next.set(id, { id, token, items }); await publish(next); ready = true;
  }); } catch (error) { stop(); throw error; }
  const registration = asyncRegistration(stop, () => serial(async () => {
    if (owners.get(id)?.token !== token) return;
    const next = new Map(owners); next.delete(id); await publish(next);
  }));
  return {
    id,
    async update(options) {
      if (stopped) throw new SparkError("E_CLOSED", "Menu was removed");
      const items = snapshot(options, token, false, Boolean(onOpen || onClose));
      await serial(async () => {
        // Callers commonly rebuild identical item literals each render; republishing the whole
        // bar would rebuild native menus for no visible change. Compare the wire trees first.
        const existing = owners.get(id);
        if (existing?.token === token && JSON.stringify(existing.items) === JSON.stringify(items)) return;
        const next = new Map(owners); next.delete(id); next.set(id, { id, token, items });
        await publish(next); ids = selectableMenuIds(items); menus = submenuIds(items);
      });
    },
    remove: registration.remove,
  };
}
export { useMenu, type MenuState, type UseMenuOptions } from "./hooks";
