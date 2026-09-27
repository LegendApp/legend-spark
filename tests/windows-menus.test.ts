import { expect, test } from "vitest";
import { composeWindowsMenus } from "../packages/native-menu/src/windows-menus";
import { menuItems, type MenuItem, type MenuWireItem } from "../packages/desktop-app/src/contracts/menu";
function wire(items: MenuItem[], owner: string): MenuWireItem[] {
  const result = menuItems(items, { types: ["action", "checkbox", "separator", "submenu"], shortcuts: true, targeting: true }, "windows");
  function visit(items: MenuWireItem[]) { for (const item of items) { item._sparkOwner = owner; if (item.items) visit(item.items); } } visit(result); return result;
}
test("menu contributions target stable IDs and removing owners restores original actions", () => {
  const base = wire([{ type: "submenu", id: "file", label: "Localized File", items: [{ type: "action", id: "open", label: "Localized Open" }, { type: "action", id: "save", label: "Save" }] }], "base");
  const extension = wire([{ type: "submenu", id: "editor", label: "File", target: { id: "file" }, items: [{ type: "action", id: "custom-open", label: "Open document", target: { id: "open" }, placement: { after: { id: "save" } }, shortcut: "CmdOrCtrl+O" }] }], "editor");
  const owners = new Map([["base", base], ["editor", extension]]);
  const menu = composeWindowsMenus(owners)[0];
  expect(menu.items!.map(item => item.id)).toEqual(["save", "custom-open"]);
  expect(menu.items![1]).toMatchObject({ _sparkOwner: "editor", shortcut: { key: "o", modifiers: 1 << 18 } });
  expect(base[0].items![0].title).toBe("Localized Open");
  owners.delete("editor"); expect(composeWindowsMenus(owners)[0].items![0]).toMatchObject({ id: "open", _sparkOwner: "base" });
});
test("same semantic roots and item IDs compose in owner order without matching labels", () => {
  const first = wire([{ type: "submenu", id: "file-a", label: "File", target: { menu: "file" }, items: [{ type: "action", id: "save", label: "Save" }] }], "one");
  const second = wire([{ type: "submenu", id: "file-b", label: "Archivo", target: { menu: "file" }, items: [{ type: "checkbox", id: "save", label: "Guardar", checked: true }] }], "two");
  const result = composeWindowsMenus(new Map([["one", first], ["two", second]]));
  expect(result).toHaveLength(1); expect(result[0].title).toBe("Archivo"); expect(result[0].items).toHaveLength(1); expect(result[0].items![0]).toMatchObject({ checked: true, _sparkOwner: "two" });
});
test("nested targets and ID-based root placement compose deterministically", () => {
  const items = wire([{ type: "submenu", id: "window", label: "Window", items: [] }, { type: "submenu", id: "tools", label: "Tools", placement: { before: { id: "window" } }, items: [{ type: "submenu", id: "nested", label: "Nested", items: [{ type: "action", id: "x", label: "X" }] }] }], "base");
  expect(composeWindowsMenus(new Map([["base", items]])).map(item => item.id)).toEqual(["tools", "window"]);
});
test("missing targets reject without mutating inputs", () => {
  for (const input of [{ target: { id: "missing" } }, { placement: { before: { id: "missing" } } }] as const) {
    const items = wire([{ type: "submenu", id: "file", label: "File", items: [], ...input }], "base");
    const before = JSON.stringify(items);
    expect(() => composeWindowsMenus(new Map([["base", items]]))).toThrow("target"); expect(JSON.stringify(items)).toBe(before);
  }
});

test("nested targets retain original ID anchors across overlays", () => {
  const base = wire([{ type: "submenu", id: "file", label: "File", items: [{ type: "submenu", id: "nested", label: "Nested", items: [{ type: "action", id: "base", label: "Base" }] }] }], "base");
  const first = wire([{ type: "submenu", id: "file", label: "File", items: [{ type: "action", id: "one", label: "One", target: { id: "base" } }] }], "one");
  const second = wire([{ type: "submenu", id: "file", label: "File", items: [{ type: "action", id: "two", label: "Two", target: { id: "base" } }] }], "two");
  const result = composeWindowsMenus(new Map([["base", base], ["one", first], ["two", second]]));
  expect(result[0].items![0].items![0]).toMatchObject({ id: "two", _sparkIdentity: "base", _sparkOwner: "two" });
});
