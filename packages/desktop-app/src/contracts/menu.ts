import { SparkError } from "./index";
import { nativePath } from "./path";
import { parseAccelerator, type Accelerator } from "./accelerator";
export type MenuIcon = { type: "symbol"; name: string } | { type: "image"; path: string };
export type MenuRole = "new" | "open" | "save" | "saveAs" | "clearRecentDocuments" | "about" | "settings" | "services" | "hide" | "hideOthers" | "showAll" | "quit" | "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "minimize" | "zoom" | "close" | "toggleFullscreen";
export type MenuLocation = "app" | "file" | "edit" | "view" | "window" | "help";
export type MenuTarget = { id: string } | { role: MenuRole } | { menu: MenuLocation };
export type MenuPlacement = { before: MenuTarget; after?: never } | { after: MenuTarget; before?: never };
interface MenuEntry { target?: MenuTarget; placement?: MenuPlacement; id: string; label: string; disabled?: boolean; hidden?: boolean; icon?: MenuIcon }
export type MenuItem =
  | { type: "separator" }
  | (MenuEntry & { type: "action"; shortcut?: string })
  | (MenuEntry & { type: "checkbox"; checked: boolean; shortcut?: string })
  | (MenuEntry & { type: "submenu"; items: readonly MenuItem[] })
  | (Omit<MenuEntry, "label"> & { type: "role"; role: MenuRole; label?: string; shortcut?: string })
  | (MenuEntry & { type: "slider"; min: number; max: number; value: number; suffix?: string });
export type MenuAction = { type: "action"; itemId: string } | { type: "valueChanged"; itemId: string; value: number };
/** Internal transport shape; never reexported from feature entry points. */
export interface MenuWireItem {
  id?: string; title?: string; target?: MenuTarget; placement?: MenuPlacement; _sparkOwner?: string; _sparkIdentity?: string; enabled?: boolean; hidden?: boolean; checked?: boolean; separator?: boolean;
  shortcut?: Accelerator; items?: MenuWireItem[]; role?: MenuRole;
  systemImageName?: string; imagePath?: string; slider?: { min: number; max: number; value: number; suffix?: string };
}
export interface MenuSupport { types: readonly MenuItem["type"][]; shortcuts?: boolean; icons?: readonly MenuIcon["type"][]; targeting?: boolean }
const roles: readonly string[] = ["new", "open", "save", "saveAs", "clearRecentDocuments", "about", "settings", "services", "hide", "hideOthers", "showAll", "quit", "undo", "redo", "cut", "copy", "paste", "selectAll", "minimize", "zoom", "close", "toggleFullscreen"];
function keys(value: object, allowed: readonly string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported menu property: ${key}`);
}
/** Validate and snapshot the complete tree before a native side effect. */
export function menuItems(input: readonly MenuItem[], support: MenuSupport, platform: "macos" | "windows"): MenuWireItem[] {
  const ids = new Set<string>();
  const active = new Set<object>();
  function visit(items: readonly MenuItem[], depth: number): MenuWireItem[] {
    if (!Array.isArray(items) || depth > 5 || active.has(items)) throw new SparkError("E_INVALID_ARGUMENT", "Menus must be acyclic arrays with at most five levels");
    active.add(items);
    try {
      return items.flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a menu item");
        if (!support.types.includes(item.type)) throw new SparkError("E_UNSUPPORTED_OPTION", `This surface does not support menu item type: ${item.type}`);
        if (item.type === "separator") { keys(item, ["type"]); return [{ separator: true }]; }
        if (typeof item.id !== "string" || !item.id.length || item.id.length > 200 || item.id.includes("\0") || ids.has(item.id)) throw new SparkError("E_INVALID_ARGUMENT", "Menu item ids must be nonempty and unique");
        ids.add(item.id);
        const common = ["type", "id", "label", "disabled", "hidden", "icon", "target", "placement"];
        keys(item, [...common, ...(item.type === "submenu" ? ["items"] : item.type === "slider" ? ["min", "max", "value", "suffix"] : item.type === "role" ? ["role", "shortcut"] : item.type === "checkbox" ? ["checked", "shortcut"] : ["shortcut"])]);
        if ((item.type !== "role" || item.label !== undefined) && (typeof item.label !== "string" || !item.label.trim())) throw new SparkError("E_INVALID_ARGUMENT", "Menu items need a label");
        if ([item.disabled, item.hidden].some(value => value !== undefined && typeof value !== "boolean")) throw new SparkError("E_INVALID_ARGUMENT", "Menu flags must be boolean");
        const result: MenuWireItem = { id: item.id, title: item.label, enabled: !item.disabled };
        if (item.target !== undefined || item.placement !== undefined) {
          if (!support.targeting) throw new SparkError("E_UNSUPPORTED_OPTION", "This menu surface does not support targeting or placement");
          if (item.target !== undefined) result.target = menuTarget(item.target);
          if (item.placement !== undefined) {
            if (!item.placement || typeof item.placement !== "object" || Array.isArray(item.placement)) throw new SparkError("E_INVALID_ARGUMENT", "Expected menu placement");
            keys(item.placement, ["before", "after"]);
            if ((item.placement.before !== undefined) === (item.placement.after !== undefined)) throw new SparkError("E_INVALID_ARGUMENT", "Placement requires exactly one of before or after");
            result.placement = item.placement.before !== undefined ? { before: menuTarget(item.placement.before) } : { after: menuTarget(item.placement.after!) };
          }
        }
        if (item.type === "checkbox") {
          if (typeof item.checked !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Checkbox menus require checked state");
          result.checked = item.checked;
        }
        if (item.type === "submenu") result.items = visit(item.items, depth + 1);
        if (item.type === "role") {
          if (!roles.includes(item.role)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown menu role");
          result.role = item.role;
        }
        if (item.type === "slider") {
          if (![item.min, item.max, item.value].every(value => typeof value === "number" && Number.isFinite(value)) || item.min >= item.max || item.value < item.min || item.value > item.max || (item.suffix !== undefined && typeof item.suffix !== "string")) throw new SparkError("E_INVALID_ARGUMENT", "Invalid menu slider range/value");
          result.slider = { min: item.min, max: item.max, value: item.value, suffix: item.suffix };
        }
        if ("shortcut" in item && item.shortcut !== undefined) {
          if (!support.shortcuts) throw new SparkError("E_UNSUPPORTED_OPTION", "This menu surface does not support shortcuts");
          result.shortcut = parseAccelerator(item.shortcut, platform);
        }
        if (item.icon !== undefined) {
          if (!item.icon || !support.icons?.includes(item.icon.type)) throw new SparkError("E_UNSUPPORTED_OPTION", "This menu surface does not support this icon type");
          if (item.icon.type === "symbol") {
            keys(item.icon, ["type", "name"]);
            if (typeof item.icon.name !== "string" || !item.icon.name.trim()) throw new SparkError("E_INVALID_ARGUMENT", "Expected a symbol name");
            result.systemImageName = item.icon.name;
          } else {
            keys(item.icon, ["type", "path"]);
            if (typeof item.icon.path !== "string" || !item.icon.path.length || item.icon.path.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an image path");
            result.imagePath = nativePath(item.icon.path, platform);
          }
        }
        if (item.hidden && item.target) result.hidden = true;
        return item.hidden && !item.target ? [] : [result];
      });
    } finally { active.delete(items); }
  }
  return visit(input, 1);
}
export function selectableMenuIds(items: readonly MenuWireItem[]): Set<string> {
  const ids = new Set<string>();
  function visit(items: readonly MenuWireItem[]) {
    for (const item of items) {
      if (!item.enabled || item.hidden) continue;
      if (item.items) visit(item.items);
      else if (item.id && !item.separator && !item.role && !item.slider) ids.add(item.id);
    }
  }
  visit(items); return ids;
}

function menuTarget(value: MenuTarget): MenuTarget {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) throw new SparkError("E_INVALID_ARGUMENT", "Expected one semantic menu target");
  if ("id" in value && typeof value.id === "string" && value.id.length && value.id.length <= 200 && !value.id.includes("\0")) return { id: value.id };
  if ("role" in value && roles.includes(value.role)) return { role: value.role };
  if ("menu" in value && ["app", "file", "edit", "view", "window", "help"].includes(value.menu)) return { menu: value.menu };
  throw new SparkError("E_INVALID_ARGUMENT", "Invalid semantic menu target");
}
