import { NativeEventEmitter, Platform } from "react-native";
import NativeMenu from "./NativeMenu";
import { SparkError, asyncRegistration, invokeNative, type Availability, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { menuItems, selectableMenuIds, type MenuItem, type MenuWireItem, type MenuAction } from "@legendapp/spark-desktop-app/src/contracts/menu";
import { composeWindowsMenus } from "./windows-menus";
export type { MenuItem, MenuIcon, MenuRole, MenuAction, MenuTarget, MenuPlacement, MenuLocation } from "@legendapp/spark-desktop-app/src/contracts/menu";
export interface MenuUpdate { items: readonly MenuItem[] }
export interface MenuOptions extends MenuUpdate { id: string; onAction?: (action: MenuAction) => void }
export interface Menu extends AsyncRegistration { readonly id: string; update(options: MenuUpdate): Promise<void> }
interface Owner { id: string; token: string; items: MenuWireItem[] }
let owners = new Map<string, Owner>();
let sequence = 0, queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> { const result = queue.then(operation); queue = result.catch(() => {}); return result; }
export function getMenuAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return NativeMenu ? { available: true } : { available: false, reason: "missing-module" };
}
function available() {
  const availability = getMenuAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Application menus are unavailable");
}
function snapshot(value: MenuUpdate, token: string, creating = false): MenuWireItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", "Expected menu options");
  for (const key of Object.keys(value)) if (!["items", ...(creating ? ["id", "onAction"] : [])].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported menu option: ${key}`);
  const items = menuItems(value.items, { types: Platform.OS === "macos" ? ["action", "checkbox", "separator", "submenu", "role"] : ["action", "checkbox", "separator", "submenu"], shortcuts: true, targeting: true, icons: Platform.OS === "macos" ? ["symbol", "image"] : [] }, Platform.OS === "windows" ? "windows" : "macos");
  if (items.some(item => !item.items)) throw new SparkError("E_INVALID_ARGUMENT", "Application menu roots must be submenus");
  function annotate(items: MenuWireItem[]) { for (const item of items) { item._sparkOwner = token; if (item.items) annotate(item.items); } }
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
  const items = snapshot(options, token, true);
  if (typeof options.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(options.id)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a menu owner id");
  if (options.onAction !== undefined && typeof options.onAction !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onAction callback");
  const id = options.id, onAction = options.onAction;
  let stopped = false, ready = false, ids = selectableMenuIds(items);
  const subscription = new NativeEventEmitter(NativeMenu as never).addListener("NativeMenuAction", event => {
    if (ready && !stopped && event && event.ownerId === token && typeof event.itemId === "string" && ids.has(event.itemId)) onAction?.({ type: "action", itemId: event.itemId });
  });
  try { await serial(async () => {
    if (owners.has(id)) throw new SparkError("E_ALREADY_EXISTS", `Menu owner ${id} already exists`);
    const next = new Map(owners); next.set(id, { id, token, items }); await publish(next); ready = true;
  }); } catch (error) { subscription.remove(); throw error; }
  const registration = asyncRegistration(() => { stopped = true; subscription.remove(); }, () => serial(async () => {
    if (owners.get(id)?.token !== token) return;
    const next = new Map(owners); next.delete(id); await publish(next);
  }));
  return {
    id,
    async update(options) {
      if (stopped) throw new SparkError("E_CLOSED", "Menu was removed");
      const items = snapshot(options, token);
      await serial(async () => {
        const next = new Map(owners); next.delete(id); next.set(id, { id, token, items });
        await publish(next); ids = selectableMenuIds(items);
      });
    },
    remove: registration.remove,
  };
}
export { useMenu, type MenuState, type UseMenuOptions } from "./hooks";
