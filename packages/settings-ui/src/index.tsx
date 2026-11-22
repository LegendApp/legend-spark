import { LegendList, type LegendListRef, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { SidebarSplitView, type SidebarSplitViewAppearance, type SidebarSplitViewResizeEvent, type SplitViewTitleBarOptions } from "@legendapp/spark-ui/src/appkit-split-view";
import { Sidebar, SidebarItem } from "@legendapp/spark-ui/src/sidebar";
import { SFSymbol } from "@legendapp/spark-ui/src/sf-symbol";
import { identifier } from "@legendapp/spark-ui/src/specialized";
import { SparkError, nativeError } from "@legendapp/spark-desktop-app/src/contracts";
import { Children, Fragment, isValidElement, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform, PlatformColor, StyleSheet, Text, View } from "react-native";

export * from "./options";
export * from "./rows";

const TITLEBAR_HEIGHT = 52;
const titleBar: SplitViewTitleBarOptions = { content: { height: TITLEBAR_HEIGHT, material: "windowBackground" } };
let windowsApi: Promise<typeof import("@legendapp/spark-desktop-windows/src/api")> | undefined;
const loadWindowsApi = () => windowsApi ??= import("@legendapp/spark-desktop-windows/src/api");

export interface SettingsPageProps<PageId extends string = string> {
  id: PageId;
  title: string;
  icon: string;
  children: ReactNode;
}

export function SettingsPage({ children }: SettingsPageProps) {
  return <>{children}</>;
}

export type SettingsWindowSelectionProps<PageId extends string = string> =
  | { selectedPageId: PageId; defaultPageId?: never; onSelectionChange: (pageId: PageId) => void }
  | { selectedPageId?: never; defaultPageId?: PageId; onSelectionChange?: (pageId: PageId) => void };

export type SettingsWindowProps<PageId extends string = string> = SettingsWindowSelectionProps<PageId> & {
  /** Immutable for this mount. Remount to change the owning window. */
  windowId: string;
  children: ReactNode;
  appearance?: SidebarSplitViewAppearance;
  onError?: (error: SparkError) => void;
};

export type VirtualizedSettingsWindowProps<PageId extends string = string> = SettingsWindowProps<PageId>;

function childPages<PageId extends string>(children: ReactNode): SettingsPageProps<PageId>[] {
  const pages: SettingsPageProps<PageId>[] = [];
  Children.forEach(children, child => {
    if (child === null) return;
    if (isValidElement<{ children: ReactNode }>(child) && child.type === Fragment) {
      pages.push(...childPages<PageId>(child.props.children));
    } else if (isValidElement<SettingsPageProps<PageId>>(child) && child.type === SettingsPage) {
      pages.push(child.props);
    } else {
      throw new SparkError("E_INVALID_ARGUMENT", "Settings windows require SettingsPage children or fragments");
    }
  });
  return pages;
}

function useSettingsSelection<PageId extends string>(props: SettingsWindowProps<PageId>, pages: readonly SettingsPageProps<PageId>[]) {
  const { windowId, selectedPageId, defaultPageId, onSelectionChange } = props;
  const controlled = selectedPageId !== undefined;
  const identity = useRef({ windowId, controlled });
  identifier(windowId, "settings window ID");
  if (identity.current.windowId !== windowId) throw new SparkError("E_INVALID_ARGUMENT", "Settings windowId must be nonempty and immutable; remount to change it");
  if (identity.current.controlled !== controlled || (controlled && defaultPageId !== undefined) || (controlled && typeof onSelectionChange !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Settings selection must have one stable owner");
  const ids = new Set<string>();
  for (const page of pages) {
    identifier(page.id, "settings page ID");
    identifier(page.title, "settings page title");
    identifier(page.icon, "settings page icon");
    if (ids.has(page.id)) throw new SparkError("E_INVALID_ARGUMENT", "Settings page IDs must be unique");
    ids.add(page.id);
  }
  if (!pages.length || (controlled && !ids.has(selectedPageId))) throw new SparkError("E_INVALID_ARGUMENT", "Settings selection must identify an existing page");
  const [local, setLocal] = useState(() => {
    if (defaultPageId !== undefined && !ids.has(defaultPageId)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown default settings page");
    return defaultPageId ?? pages[0].id;
  });
  const selected = controlled ? selectedPageId : ids.has(local) ? local : pages[0].id;
  useEffect(() => { if (!controlled && local !== selected) setLocal(selected); }, [controlled, local, selected]);
  const [revision, setRevision] = useState(0);
  const requestSelection = useCallback((id: PageId) => {
    if (selected === id) return;
    // A controlled parent may keep its value, so request a scroll even if it stays the same.
    if (controlled) setRevision(value => value + 1);
    else setLocal(id);
    onSelectionChange?.(id);
  }, [controlled, onSelectionChange, selected]);
  return { selected, requestSelection, revision };
}

function useSettingsWindow(windowId: string, title: string, appearance: SidebarSplitViewAppearance, onError: SettingsWindowProps["onError"]) {
  const errorRef = useRef(onError); errorRef.current = onError;
  const active = useRef(false);
  const contentReady = useRef(false);
  const splitReady = useRef(false);
  const shown = useRef(false);
  const report = useCallback((cause: unknown) => {
    if (active.current) {
      const error = nativeError(cause);
      if (errorRef.current) errorRef.current(error); else console.error(error);
    }
  }, []);
  const showIfReady = useCallback(() => {
    if (!active.current || !contentReady.current || !splitReady.current || shown.current) return;
    shown.current = true;
    void loadWindowsApi().then(async windows => {
      if (!active.current) { shown.current = false; return; }
      await windows.showWindow(windowId);
    }).catch(cause => { shown.current = false; report(cause); });
  }, [report, windowId]);
  useLayoutEffect(() => { active.current = true; showIfReady(); return () => { active.current = false; }; }, [showIfReady]);
  useEffect(() => {
    let current = true;
    void loadWindowsApi().then(async windows => {
      if (current) await windows.setWindowOptions(windowId, { title, appearance });
    }).catch(cause => { if (current) report(cause); });
    return () => { current = false; };
  }, [appearance, report, title, windowId]);
  const onResize = useCallback((event: SidebarSplitViewResizeEvent) => {
    if (event.phase === "ready" && event.contentHeight > 0 && event.contentWidth > 0 && event.sidebarHeight > 0 && event.sidebarWidth > 0) {
      splitReady.current = true; showIfReady();
    }
  }, [showIfReady]);
  const markContentReady = useCallback(() => { contentReady.current = true; showIfReady(); }, [showIfReady]);
  return { onResize, markContentReady, report };
}

export function VirtualizedSettingsWindow<PageId extends string = string>(props: VirtualizedSettingsWindowProps<PageId>) {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Settings windows require macOS");
  const { appearance = "system", children, windowId, onError } = props;
  const pages = useMemo(() => childPages<PageId>(children), [children]);
  const { selected, requestSelection, revision } = useSettingsSelection(props, pages);
  const listRef = useRef<LegendListRef | null>(null);
  const pageIndex = pages.findIndex(page => page.id === selected);
  const { onResize, markContentReady, report } = useSettingsWindow(windowId, pages[pageIndex].title, appearance, onError);
  const [viewportHeight, setViewportHeight] = useState(0);
  const hasLayout = viewportHeight > 0;
  const scrollingToPage = useRef(false);
  const visiblePage = useRef<PageId | undefined>(undefined);
  const initialized = useRef(false);

  useEffect(() => {
    if (!hasLayout) return;
    let current = true;
    scrollingToPage.current = true;
    const frame = requestAnimationFrame(() => {
      if (visiblePage.current === selected && initialized.current) { scrollingToPage.current = false; return; }
      const list = listRef.current;
      if (!list) { report(new SparkError("E_UNAVAILABLE", "Settings list is not mounted")); return; }
      visiblePage.current = undefined;
      void list.scrollToIndex({ animated: initialized.current, index: pageIndex, viewOffset: TITLEBAR_HEIGHT, viewPosition: 0 })
        .then(() => { if (current) visiblePage.current = selected; })
        .catch(cause => { if (current) report(cause); })
        .finally(() => {
          if (!current) return;
          initialized.current = true;
          scrollingToPage.current = false;
          markContentReady();
        });
    });
    return () => { current = false; cancelAnimationFrame(frame); };
  }, [hasLayout, markContentReady, pageIndex, report, revision, selected]);

  const onScroll = useCallback(() => {
    if (!initialized.current || scrollingToPage.current) return;
    const state = listRef.current?.getState();
    if (!state || state.start < 0) return;
    let index = state.start;
    while (index < pages.length - 1 && state.positionAtIndex(index + 1) <= state.scroll + 0.5) index++;
    const page = pages[index];
    if (page && visiblePage.current !== page.id) {
      visiblePage.current = page.id;
      requestSelection(page.id);
    }
  }, [pages, requestSelection]);

  // Keep short pages tall enough to align at the top and avoid opening on two pages at once.
  const pageHeight = Math.max(0, viewportHeight - TITLEBAR_HEIGHT);
  const renderItem = useCallback(({ item }: LegendListRenderItemProps<SettingsPageProps<PageId>>) => (
    <View style={[styles.page, { minHeight: pageHeight }]}>
      {item.children}
    </View>
  ), [pageHeight]);

  return (
    <SidebarSplitView appearance={appearance} contentMinWidth={340} sidebarMinWidth={180} sidebarWidth={200} titleBar={titleBar} style={styles.fill}
      onResize={event => { if (event.contentWidth > 0) setViewportHeight(event.contentHeight); onResize(event); }} onError={report}
      sidebar={
        <Sidebar defaultRowHeight={30} contentInsetTop={66} selectedId={selected} style={styles.fill} onError={report}
          onSelectionChange={({ id }) => { if (id !== null) requestSelection(id as PageId); }}>
          {pages.map(({ id, title, icon }) => {
            const active = id === selected;
            const foreground = active ? PlatformColor("alternateSelectedControlTextColor") : PlatformColor("labelColor");
            return (
              <SidebarItem key={id} id={id} accessibilityLabel={title} onError={report}>
                <View pointerEvents="none" style={styles.sidebarRow}>
                  <View style={styles.sidebarIcon}>
                    <SFSymbol name={icon} size={16} color={active ? foreground : PlatformColor("secondaryLabelColor")} onError={report} />
                  </View>
                  <Text numberOfLines={1} style={[styles.sidebarLabel, { color: foreground }]}>{title}</Text>
                </View>
              </SidebarItem>
            );
          })}
        </Sidebar>
      }
      content={hasLayout ? (
        <LegendList ref={listRef} data={pages} keyExtractor={pageKey} renderItem={renderItem} estimatedItemSize={Math.max(1, pageHeight)}
          contentContainerStyle={styles.listContent} contentInsetAdjustmentBehavior="never"
          onFirstVisibleItemChanged={onScroll} onScroll={onScroll} scrollEventThrottle={16} style={styles.fill} />
      ) : null}
    />
  );
}

export { VirtualizedSettingsWindow as SettingsWindow };

const pageKey = (page: SettingsPageProps) => page.id;

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  listContent: { paddingTop: TITLEBAR_HEIGHT },
  page: { alignSelf: "center", width: "100%", maxWidth: 760, padding: 20, gap: 20 },
  sidebarRow: { flexDirection: "row", alignItems: "center", height: 30, gap: 10, paddingHorizontal: 10 },
  sidebarIcon: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  sidebarLabel: { fontSize: 13, flexShrink: 1 },
});
