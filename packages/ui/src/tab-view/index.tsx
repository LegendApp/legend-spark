import { Children, Fragment, isValidElement, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { isEventCount, useControl, useEventAcknowledgment } from "../control";
import { finite, identifier, macosViewAvailability, requireAvailable, type SpecializedViewProps } from "../specialized";
import NativeTabView from "./TabViewNativeComponent";
import NativeTab from "./TabNativeComponent";

/** Where AppKit draws the tabs; `none` is a tabless view switched only by `selectedId`. */
export type TabPosition = "top" | "bottom" | "leading" | "trailing" | "none";
/** AppKit draws tabs on a bezel, so `line` and `none` require `tabPosition: "none"`. */
export type TabBorder = "bezel" | "line" | "none";
export interface TabViewSelectionEvent { id: string }
export interface TabViewProps extends Omit<SpecializedViewProps, "children"> {
  /** Controlled; must name a Tab. */
  selectedId: string;
  onSelectionChange: (event: TabViewSelectionEvent) => void;
  tabPosition?: TabPosition;
  tabBorder?: TabBorder;
  /** Tab elements or fragments of them, in tab order. */
  children: ReactNode;
}
export interface TabProps {
  id: string;
  label: string;
  /** On the tab's content view, not its tab button. */
  testID?: string;
  /** Mounted while the TabView is mounted, sized to the content area. */
  children?: ReactNode;
}
const POSITIONS: readonly TabPosition[] = ["top", "bottom", "leading", "trailing", "none"];
const BORDERS: readonly TabBorder[] = ["bezel", "line", "none"];
export function getTabViewAvailability() {
  const availability = macosViewAvailability("SparkTabView");
  return availability.available ? macosViewAvailability("SparkTab") : availability;
}
function tabs(children: ReactNode): ReactElement<TabProps>[] {
  const result: ReactElement<TabProps>[] = [];
  Children.forEach(children, child => {
    if (child === null || child === undefined || typeof child === "boolean") return;
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) { result.push(...tabs(child.props.children)); return; }
    if (!isValidElement<TabProps>(child) || child.type !== Tab) throw new SparkError("E_INVALID_ARGUMENT", "TabView children must be Tab elements or fragments");
    result.push(child);
  });
  return result;
}

/** An AppKit tab view with React content per tab. macOS only; elsewhere rendering throws. */
export function TabView({ selectedId, onSelectionChange, tabPosition = "top", tabBorder = "bezel", children, ref, onError, ...props }: TabViewProps) {
  if (typeof onSelectionChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "TabView selection is controlled and requires onSelectionChange");
  if (!POSITIONS.includes(tabPosition)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid tab position");
  if (!BORDERS.includes(tabBorder)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid tab border");
  if (tabBorder !== "bezel" && tabPosition !== "none") throw new SparkError("E_UNSUPPORTED_OPTION", "AppKit draws tabs on a bezel; line and borderless tab views have no tabs");
  const { elements, ids } = useMemo(() => {
    const elements = tabs(children), ids = new Set<string>();
    for (const { props: tab } of elements) {
      identifier(tab.id, "tab ID"); identifier(tab.label, "tab label");
      if (ids.has(tab.id)) throw new SparkError("E_INVALID_ARGUMENT", "Tab IDs must be unique");
      ids.add(tab.id);
    }
    return { elements, ids };
  }, [children]);
  if (!ids.has(selectedId)) throw new SparkError("E_INVALID_ARGUMENT", "selectedId must name a Tab");
  requireAvailable(getTabViewAvailability(), "TabView");
  const control = useControl({ ref, onError });
  const events = useEventAcknowledgment();
  const [content, setContent] = useState({ width: 0, height: 0 });
  function selected(event: NativeSyntheticEvent<{ id: string; eventCount: number }>) {
    const data = event?.nativeEvent;
    if (!isEventCount(data?.eventCount)) { control.error(new SparkError("E_INVALID_DATA", "Invalid native tab selection")); return; }
    // Echo every count, including an invalid or vetoed selection: native restores `selectedId` once caught up.
    if (!events.acknowledge(data.eventCount) || !control.active()) return;
    if (typeof data.id !== "string" || !ids.has(data.id)) { control.error(new SparkError("E_INVALID_DATA", "Native selection is not a tab")); return; }
    onSelectionChange({ id: data.id });
  }
  function layout(event: NativeSyntheticEvent<{ width: number; height: number }>) {
    if (!control.active()) return;
    const { width, height } = event?.nativeEvent ?? {};
    try { finite(width, "content width"); finite(height, "content height"); }
    catch (cause) { control.error(new SparkError("E_INVALID_DATA", "Invalid tab view layout", { cause })); return; }
    setContent(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }
  // Tabs sit at the top-left of AppKit's content area, which the native view measures.
  const frame = { position: "absolute", left: 0, top: 0, width: content.width, height: content.height, overflow: "hidden" } as const;
  return <NativeTabView {...props} ref={control.ref} selectedId={selectedId} eventCount={events.eventCount} tabPosition={tabPosition} tabBorder={tabBorder}
    onTabViewSelectionChange={selected} onTabViewContentLayout={layout}>
    {elements.map(({ props: tab }) => <NativeTab key={tab.id} tabId={tab.id} label={tab.label} testID={tab.testID} style={frame}>{tab.children}</NativeTab>)}
  </NativeTabView>;
}
/** A tab of a TabView. TabView renders its content; a Tab anywhere else throws. */
export function Tab(_props: TabProps): ReactNode {
  throw new SparkError("E_INVALID_ARGUMENT", "Tab requires a TabView parent");
}
