import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { MenuTarget, MenuWireItem } from "@legendapp/spark-desktop-app/src/contracts/menu";
function matches(item: MenuWireItem, target: MenuTarget): boolean {
  return "id" in target ? (item._sparkIdentity ?? item.id) === target.id : "role" in target ? item.role === target.role : !!item.target && "menu" in item.target && item.target.menu === target.menu;
}
function insertion(items: MenuWireItem[], placement?: MenuWireItem["placement"]): number {
  if (!placement) return items.length;
  const target = placement.before ?? placement.after!;
  const index = items.findIndex(item => matches(item, target));
  if (index < 0) throw new SparkError("E_NOT_FOUND", "Menu placement target was not found");
  return index + (placement.after ? 1 : 0);
}
function locate(items: MenuWireItem[], target: MenuTarget, recursive: boolean): { items: MenuWireItem[]; item: MenuWireItem } | undefined {
  for (const item of items) {
    if (matches(item, target)) return { items, item };
    if (recursive && item.items) { const found = locate(item.items, target, true); if (found) return found; }
  }
}
/** Compose fresh snapshots by stable IDs/semantic targets; failed proposals never mutate live owners. */
export function composeWindowsMenus(owners: ReadonlyMap<string, readonly MenuWireItem[]>): MenuWireItem[] {
  const result: MenuWireItem[] = [];
  function merge(into: MenuWireItem[], inputs: readonly MenuWireItem[], root: boolean) {
    for (const input of inputs) {
      const found = input.target || input.id ? locate(into, input.target ?? { id: input.id! }, !!input.target && !root) : undefined;
      const target = found?.item, siblings = found?.items ?? into;
      if (input.target && !target && !(root && "menu" in input.target)) throw new SparkError("E_NOT_FOUND", `Menu target for ${input.id} was not found`);
      if (target && input.items) {
        if (!target.items) throw new SparkError("E_INVALID_ARGUMENT", "Submenu target is not a submenu");
        const { items: children, id, target: identity, placement, ...presentation } = input;
        Object.assign(target, presentation);
        merge(target.items, children, false);
        if (placement) {
          const old = siblings.indexOf(target), position = insertion(siblings, placement);
          siblings.splice(old, 1); siblings.splice(position - (old < position ? 1 : 0), 0, target);
        }
      } else {
        const item = { ...input, ...(target ? { _sparkIdentity: target._sparkIdentity ?? target.id } : {}), ...(input.items ? { items: [] as MenuWireItem[] } : {}) };
        if (input.items) merge(item.items!, input.items, false);
        const index = target ? siblings.indexOf(target) : -1;
        const position = input.placement ? insertion(siblings, input.placement) : index < 0 ? siblings.length : index;
        if (index >= 0) siblings.splice(index, 1);
        siblings.splice(position - (index >= 0 && index < position ? 1 : 0), 0, item);
      }
    }
  }
  for (const items of owners.values()) merge(result, items, true);
  return result;
}
