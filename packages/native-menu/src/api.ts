import { NativeEventEmitter, Platform } from "react-native";
import NativeMenu from "./NativeMenu";
import { SparkError, asyncRegistration, invokeNative, type Availability, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { menuItems, selectableMenuIds, type MenuInputItem, type MenuWireItem, type MenuAction as SharedMenuAction } from "@legendapp/spark-desktop-app/src/contracts/menu";
import { setShortcutInventory, type ShortcutInventoryEntry } from "@legendapp/spark-desktop-app/src/contracts/shortcut-inventory";
import { composeWindowsMenus } from "./windows-menus";
import { wireDecorators } from "./wire-decorators";
type MenuLeaf = Extract<MenuInputItem, { type: "separator" | "action" | "checkbox" | "role" }>;
/** An application-menu item: an action, checkbox, separator, role or submenu from the shared menu model, plus macOS's `alternate` and checkbox `checked: 'mixed'`. Radio and slider items are not accepted. */
export type MenuItem = MenuLeaf | (Omit<Extract<MenuInputItem, { type: "submenu" }>, "items"> & { items: readonly MenuItem[] });
/** Application-menu features for `getMenuAvailability(feature)`. macOS supports all of them; Windows supports only `hiddenItems`. */
export type MenuFeature = "alternates" | "lifecycle" | "helpSearch" | "mixedState" | "icons" | "hiddenItems";
/** Passed to `onOpen` and `onClose`. `menuId` is the contributed submenu item's ID, not the owner ID. */
export interface MenuLifecycleEvent { menuId: string }
/** Passed to `onAction` when the user chooses an enabled, visible item; `itemId` is its ID. */
export type MenuAction = Extract<SharedMenuAction, { type: "action" }>;
export type { MenuIcon, MenuRole, MenuTarget, MenuPlacement, MenuLocation } from "@legendapp/spark-desktop-app/src/contracts/menu";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
/** A top-level application-menu item. Roots must be submenus. */
export type MenuRootItem = Extract<MenuItem, { type: "submenu" }>;
/** Input for `menu.update`: the owner's complete list of root submenus, replacing its previous contribution. */
export interface MenuUpdate { items: readonly MenuRootItem[] }
/** Options for `createMenu`. `id` names the owner (1-100 letters, digits, `_` or `-`) and must be unique among live menus. `onOpen` and `onClose` are macOS only. */
export interface MenuOptions extends MenuUpdate { id: string; onAction?: (action: MenuAction) => void; onOpen?: (event: MenuLifecycleEvent) => void; onClose?: (event: MenuLifecycleEvent) => void }
/** An application-menu contribution from `createMenu`. `update` republishes its items and rejects `E_CLOSED` after removal; `remove` withdraws them. */
export interface Menu extends AsyncRegistration { readonly id: string; update(options: MenuUpdate): Promise<void> }
interface Owner { id: string; token: string; items: MenuWireItem[] }
let owners = new Map<string, Owner>();
let sequence = 0, queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> { const result = queue.then(operation); queue = result.catch(() => {}); return result; }
/** Reports application-menu availability on macOS and Windows; with a feature, also whether this host supports it (Windows reports `host-restriction` for every feature except `hiddenItems`). Throws `E_INVALID_ARGUMENT` for an unknown feature. */
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
function snapshot(id: string, value: MenuUpdate, token: string, creating = false, lifecycle = false): MenuWireItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", "Expected menu options");
  for (const key of Object.keys(value)) if (!["items", ...(creating ? ["id", "onAction", "onOpen", "onClose"] : [])].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported menu option: ${key}`);
  const items = applicationItems(value.items);
  if (items.some(item => !item.items)) throw new SparkError("E_INVALID_ARGUMENT", "Application menu roots must be submenus");
  wireDecorators.get(id)?.(items);
  function annotate(items: MenuWireItem[]) { for (const item of items) { item._sparkOwner = token; if (item.items) { if (lifecycle) item._sparkLifecycle = true; annotate(item.items); } } }
  annotate(items); return items;
}
async function publish(next: Map<string, Owner>): Promise<void> {
  const placed = new Map<MenuWireItem, MenuWireItem>();
  const menus = Platform.OS === "windows"
    ? composeWindowsMenus(new Map([...next].map(([id, owner]) => [id, owner.items])), placed)
    : [...next.values()].flatMap(owner => owner.items);
  const result = await invokeNative(() => NativeMenu!.publish(JSON.stringify(menus)));
  // macOS reports the title each item shows (a located native root keeps its system-localized one); Windows shows the composed titles.
  owners = next;
  const title = Platform.OS === "windows" ? windowsTitle(result, placed) : macosTitle(result);
  // Disabled items are reported too: enabling one makes its key equivalent live again.
  const shortcuts: ShortcutInventoryEntry[] = [];
  const visit = (menuId: string, items: readonly MenuWireItem[], parent: readonly string[]) => { for (const item of items) {
    if (item.separator) continue;
    const itemId = item.id ?? item.role, path = [...parent, title(item)];
    if (item.shortcut && itemId) shortcuts.push({ accelerator: item.shortcut, owner: { source: "menu", menuId, itemId, path } });
    if (item.items) visit(menuId, item.items, path);
  } };
  for (const owner of next.values()) visit(owner.id, owner.items, []);
  setShortcutInventory(inventoryToken, shortcuts);
}
function windowsTitle(result: unknown, placed: ReadonlyMap<MenuWireItem, MenuWireItem>) {
  if (result !== undefined && result !== null) throw new SparkError("E_INVALID_DATA", "Native menu publication returned an unexpected result");
  return (item: MenuWireItem) => placed.get(item)!.title!;
}
function macosTitle(result: unknown) {
  let titles: unknown;
  try { titles = typeof result === "string" ? JSON.parse(result) : undefined; } catch { titles = undefined; }
  if (!titles || typeof titles !== "object") throw new SparkError("E_INVALID_DATA", "Native menu publication did not report its titles");
  const shown = titles as Record<string, Record<string, unknown> | undefined>;
  return (item: MenuWireItem) => {
    const value = shown[item._sparkOwner!]?.[item.id!];
    if (typeof value !== "string") throw new SparkError("E_INVALID_DATA", `Native menu publication did not report the title of ${item.id}`);
    return value;
  };
}
const inventoryToken = {};
/**
 * Publishes an owner's contribution to the application menu bar and resolves once native publication is acknowledged. Contributions merge by item ID, and later owners take precedence.
 * Rejects `E_ALREADY_EXISTS` for a duplicate owner `id`, `E_INVALID_ARGUMENT` for an invalid `id`, items or callbacks, `E_UNSUPPORTED_OPTION` for lifecycle callbacks outside macOS,
 * and `E_UNSUPPORTED_PLATFORM` or `E_MODULE_UNAVAILABLE` when application menus are unavailable.
 */
export async function createMenu(options: MenuOptions): Promise<Menu> {
  available();
  const token = `menu-${Date.now()}-${++sequence}`;
  const items = snapshot(options?.id, options, token, true, Boolean(options?.onOpen || options?.onClose));
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
      const items = snapshot(id, options, token, false, Boolean(onOpen || onClose));
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
export { addDeveloperMenuListener, getDeveloperMenuState, type DeveloperMenuShortcutConflict, type DeveloperMenuState } from "./developer-menu-state";
