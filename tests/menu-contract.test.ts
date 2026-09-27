import { expect, test } from "vitest";
import { menuItems, selectableMenuIds, type MenuItem } from "../packages/desktop-app/src/contracts/menu";
const support = { types: ["action", "checkbox", "separator", "submenu", "role", "slider"] as const, shortcuts: true, icons: ["symbol", "image"] as const };
test("shared menus snapshot labels, flags, shortcuts and icons", () => {
  const items: MenuItem[] = [{ type: "action", id: "open", label: "Open", shortcut: "CmdOrCtrl+O", icon: { type: "symbol", name: "folder" } }, { type: "checkbox", id: "checked", label: "Checked", checked: true }, { type: "action", id: "hidden", label: "Hidden", hidden: true }];
  const result = menuItems(items, support, "windows");
  expect(result).toEqual([{ id: "open", title: "Open", enabled: true, shortcut: { key: "o", modifiers: 1 << 18 }, systemImageName: "folder" }, { id: "checked", title: "Checked", enabled: true, checked: true }]);
  if (items[0].type !== "separator") items[0].label = "Changed"; expect(result[0].title).toBe("Open");
});
test("nested menus have unique ids across the tree and exclude disabled ancestors from selection", () => {
  const items: MenuItem[] = [{ type: "submenu", id: "nested", label: "Nested", disabled: true, items: [{ type: "action", id: "child", label: "Child" }] }, { type: "action", id: "other", label: "Other" }];
  expect(selectableMenuIds(menuItems(items, support, "macos"))).toEqual(new Set(["other"]));
  items.push({ type: "action", id: "child", label: "Duplicate" }); expect(() => menuItems(items, support, "macos")).toThrow("unique");
});
test("roles, numeric sliders and image paths validate at the shared boundary", () => {
  expect(menuItems([{ type: "slider", id: "volume", label: "Volume", min: 0, max: 1, value: 0.5, suffix: "%" }, { type: "role", id: "quit", role: "quit" }], support, "macos")[0].slider).toEqual({ min: 0, max: 1, value: 0.5, suffix: "%" });
  for (const item of [{ type: "checkbox", id: "x", label: "X" }, { type: "role", id: "quit", role: "explode" }, { type: "slider", id: "x", label: "X", min: 0, max: 1, value: 2 }, { type: "action", id: "x", label: "X", icon: { type: "image", path: "relative.png" } }]) expect(() => menuItems([item] as never, support, "macos")).toThrow();
});
test("unsupported surface features reject and cyclic trees cannot reach native serialization", () => {
  expect(() => menuItems([{ type: "action", id: "x", label: "X", shortcut: "Cmd+K" }], { types: ["action"] }, "macos")).toThrow("shortcuts");
  expect(() => menuItems([{ type: "slider", id: "x", label: "X", min: 0, max: 1, value: 0 }], { types: ["action"] }, "macos")).toThrow("type");
  const items: MenuItem[] = []; items.push({ type: "submenu", id: "x", label: "X", items });
  expect(() => menuItems(items, support, "macos")).toThrow("acyclic");
  expect(() => menuItems([{ type: "action", id: "x", label: "X", backend: true }] as never, support, "macos")).toThrow("property");
});

test("semantic targets validate their shape and hidden target overrides remain in publication", () => {
  const supported = { ...support, targeting: true };
  const result = menuItems([{ type: "action", id: "copy", label: "Copy", target: { role: "copy" }, hidden: true, placement: { after: { id: "paste" } } }], supported, "macos");
  expect(result[0]).toMatchObject({ hidden: true, target: { role: "copy" }, placement: { after: { id: "paste" } } });
  expect(selectableMenuIds(result).size).toBe(0);
  for (const target of [{ id: "", role: "copy" }, { role: "bad" }, { menu: "unknown" }]) expect(() => menuItems([{ type: "action", id: "x", label: "X", target }] as never, supported, "macos")).toThrow();
  expect(() => menuItems([{ type: "action", id: "x", label: "X", target: { role: "copy" } }], support, "macos")).toThrow("targeting");
});
