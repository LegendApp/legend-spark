import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import { Platform } from "react-native";
import Native from "./NativeDesktopTray";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { SparkError, asyncRegistration, invokeNative, parseNativeResult, type Availability, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { menuItems, selectableMenuIds, type MenuItem, type MenuWireItem } from "@legendapp/spark-desktop-app/src/contracts/menu";
export type { MenuItem, MenuIcon, MenuRole, MenuAction } from "@legendapp/spark-desktop-app/src/contracts/menu";
export type TrayAction = { type: "click" } | { type: "action"; itemId: string };
export interface TrayUpdate {
  /** Visible text on macOS; accessible tooltip fallback on Windows. */
  title?: string;
  /** Local image file; PNG is supported on both desktop hosts. Null clears it. */
  image?: { path: string } | null;
  tooltip?: string;
  /** Replaces the entire menu; [] removes it. */
  menu?: readonly MenuItem[];
  /** Replaces macOS presentation options; null clears the symbol. */
  macos?: { symbol?: string | null };
}
export interface TrayOptions extends TrayUpdate { id: string; onAction?: (action: TrayAction) => void }
export interface Tray extends AsyncRegistration { readonly id: string; update(changes: TrayUpdate): Promise<void> }
interface Wire { id: string; instanceId: string; imagePath: string; title: string; tooltip?: string; symbol: string; menu: MenuWireItem[] }
export function getTrayAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
async function call(method: string, args: object): Promise<void> {
  const available = getTrayAvailability();
  if (!available.available) throw new SparkError(available.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Tray is unavailable");
  parseNativeResult(await invokeNative(() => Native!.call(method, JSON.stringify(args))), (value): value is null => value === null);
}
function validate(options: TrayUpdate, creating = false): Partial<Wire> {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected tray options");
  for (const key of Object.keys(options)) if (!["title", "tooltip", "image", "menu", "macos", ...(creating ? ["id", "onAction"] : [])].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported tray option: ${key}`);
  const result: Partial<Wire> = {};
  for (const key of ["title", "tooltip"] as const) if (options[key] !== undefined) {
    if (typeof options[key] !== "string" || options[key].includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", `Tray ${key} must be a string without NUL`);
    result[key] = options[key];
  }
  if (options.image !== undefined) {
    if (options.image === null) result.imagePath = "";
    else {
      if (!options.image || typeof options.image !== "object" || Array.isArray(options.image) || Object.keys(options.image).some(key => key !== "path")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an image path or null");
      result.imagePath = nativePath(options.image.path, Platform.OS);
    }
  }
  if (options.macos !== undefined) {
    if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_OPTION", "macos tray options require macOS");
    if (!options.macos || typeof options.macos !== "object" || Array.isArray(options.macos) || Object.keys(options.macos).some(key => key !== "symbol")) throw new SparkError("E_INVALID_ARGUMENT", "Expected macos tray options");
    const symbol = options.macos.symbol;
    if (symbol != null && (typeof symbol !== "string" || !symbol.trim() || symbol.includes("\0"))) throw new SparkError("E_INVALID_ARGUMENT", "Expected an SF Symbol name or null");
    result.symbol = symbol ?? "";
  }
  if (options.menu !== undefined) result.menu = menuItems(options.menu, { types: ["action", "checkbox", "separator", "submenu"] }, Platform.OS === "windows" ? "windows" : "macos");
  return result;
}
function presentation(options: Wire) {
  if (options.imagePath && options.symbol) throw new SparkError("E_INVALID_ARGUMENT", "Choose a tray image or macOS symbol");
  if (!options.title.trim() && !options.symbol && !options.imagePath) throw new SparkError("E_INVALID_ARGUMENT", "Tray needs a title, image or macOS symbol");
}
let sequence = 0;
export async function createTray(options: TrayOptions): Promise<Tray> {
  const changes = validate(options, true);
  if (typeof options.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(options.id)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid tray id");
  if (options.onAction !== undefined && typeof options.onAction !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onAction callback");
  const id = options.id, onAction = options.onAction;
  const instanceId = `tray-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`;
  let current: Wire = { id, instanceId, imagePath: "", title: "", symbol: "", menu: [], ...changes };
  presentation(current);
  const available = getTrayAvailability();
  if (!available.available) throw new SparkError(available.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Tray is unavailable");
  let stopped = false, ready = false;
  let selected = selectableMenuIds(current.menu);
  let queue: Promise<unknown> = Promise.resolve();
  const sub = onDesktopEvent(event => {
    if (!ready || stopped || event.trayId !== id || event.instanceId !== instanceId) return;
    if (event.type === "trayClick") onAction?.({ type: "click" });
    else if (event.type === "trayAction" && typeof event.itemId === "string" && selected.has(event.itemId)) onAction?.({ type: "action", itemId: event.itemId });
  }, { types: ["trayClick", "trayAction"], target: { field: "trayId", value: id } });
  try { await call("create", current); ready = true; } catch (error) { sub.remove(); throw error; }
  const registration = asyncRegistration(() => { stopped = true; sub.remove(); }, async () => { await queue; await call("remove", { id, instanceId }); });
  return {
    id,
    async update(changes) {
      if (stopped) throw new SparkError("E_CLOSED", "Tray was removed");
      const snapshot = validate(changes);
      const next = queue.then(async () => {
        const options = { ...current, ...snapshot };
        presentation(options);
        await call("update", { id, instanceId, ...snapshot });
        current = options;
        if (snapshot.menu !== undefined) selected = selectableMenuIds(options.menu);
      });
      queue = next.catch(() => {});
      await next;
    },
    remove: registration.remove,
  };
}
