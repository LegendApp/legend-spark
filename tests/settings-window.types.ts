import type { SettingsWindowProps, VirtualizedSettingsWindowProps } from "../packages/desktop/ui-settings";
const simple: SettingsWindowProps<"general"> = { windowId: "settings", children: null, defaultPageId: "general" };
const scrolling: VirtualizedSettingsWindowProps<"general"> = simple;
// @ts-expect-error Controlled selection needs its callback.
const missing: SettingsWindowProps<"general"> = { windowId: "settings", children: null, selectedPageId: "general" };
// @ts-expect-error Selection has one owner.
const ambiguous: SettingsWindowProps<"general"> = { ...simple, selectedPageId: "general", defaultPageId: "general", onSelectionChange() {} };
// @ts-expect-error Defaults respect an explicitly supplied page ID type.
const unknown: SettingsWindowProps<"general"> = { ...simple, defaultPageId: "advanced" };
void [simple, scrolling, missing, ambiguous, unknown];
