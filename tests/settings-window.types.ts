import type { SettingsWindowProps, VirtualizedSettingsWindowProps } from "../packages/settings-ui/src";
const pages = [{ id: "general" as const, title: "General", render: () => null }];
const simple: SettingsWindowProps<"general"> = { windowId: "settings", pages, defaultPageId: "general" };
const scrolling: VirtualizedSettingsWindowProps<"general"> = { ...simple, estimatedItemSize: 100 };
// @ts-expect-error Controlled selection needs its callback.
const missing: SettingsWindowProps<"general"> = { windowId: "settings", pages, selectedPageId: "general" };
// @ts-expect-error Selection has one owner.
const ambiguous: SettingsWindowProps<"general"> = { ...simple, selectedPageId: "general", defaultPageId: "general", onSelectionChange() {} };
// @ts-expect-error Defaults identify a declared page.
const unknown: SettingsWindowProps<"general"> = { ...simple, defaultPageId: "advanced" };
void [simple, scrolling, missing, ambiguous, unknown];
