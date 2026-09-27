import { LegendList, type LegendListRef, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { cn } from "@legendapp/spark-ui/src/classnames";
import { SidebarSplitView, type SidebarSplitViewAppearance, type SidebarSplitViewResizeEvent } from "@legendapp/spark-ui/src/appkit-split-view";
import { SparkError, nativeError } from "@legendapp/spark-desktop-app/src/contracts";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

const SETTINGS_SIDEBAR_TOP_INSET = 40;
const SETTINGS_TITLEBAR_CONTENT_INSET = 56;
const settingsContentInset = { bottom: 0, left: 0, right: 0, top: SETTINGS_TITLEBAR_CONTENT_INSET };
const settingsSidebarPressablePlatformProps = Platform.OS === "macos" ? { enableFocusRing: false } : {};
const SettingsRowGroupContext = createContext(false);
export * from "./options";

export interface SettingsWindowPage<PageId extends string = string> {
  id: PageId;
  title: string;
  render: () => ReactNode;
}
export interface SettingsWindowBaseProps<PageId extends string = string> {
  /** Immutable for this mount. Remount to change the owning window. */
  windowId: string;
  pages: readonly SettingsWindowPage<PageId>[];
  appearance?: SidebarSplitViewAppearance;
  backgroundClassName?: string;
  contentBackgroundClassName?: string;
  contentMinWidth?: number;
  sidebarMinWidth?: number;
  onError?: (error: SparkError) => void;
}
export type SettingsWindowSelectionProps<PageId extends string = string> =
  | { selectedPageId: PageId; defaultPageId?: never; onSelectionChange: (pageId: PageId) => void }
  | { selectedPageId?: never; defaultPageId?: PageId; onSelectionChange?: (pageId: PageId) => void };
export type SettingsWindowProps<PageId extends string = string> = SettingsWindowBaseProps<PageId> & SettingsWindowSelectionProps<PageId>;
export type VirtualizedSettingsWindowProps<PageId extends string = string> = SettingsWindowProps<PageId> & { estimatedItemSize?: number };

function useSettingsSelection<PageId extends string>(props: SettingsWindowProps<PageId>) {
  const { pages, windowId, selectedPageId, defaultPageId, onSelectionChange } = props;
  const controlled = selectedPageId !== undefined;
  const identity = useRef({ windowId, controlled });
  if (!windowId || windowId.includes("\0") || identity.current.windowId !== windowId) throw new SparkError("E_INVALID_ARGUMENT", "Settings windowId must be nonempty and immutable; remount to change it");
  if (identity.current.controlled !== controlled || (controlled && defaultPageId !== undefined) || (controlled && typeof onSelectionChange !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Settings selection must have one stable owner");
  const ids = new Set<string>();
  for (const page of pages) {
    if (!page.id || page.id.includes("\0") || ids.has(page.id) || !page.title || typeof page.render !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Settings pages require unique nonempty IDs, titles and render callbacks");
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
    if (!pages.some(page => page.id === id)) return;
    if (!controlled) setLocal(id);
    // A controlled parent may keep its value; the scrolling variant must restore it.
    setRevision(value => value + 1);
    if (selected !== id) onSelectionChange?.(id);
  }, [controlled, onSelectionChange, pages, selected]);
  return { selected, requestSelection, revision };
}

function useSettingsWindow(windowId: string, title: string, appearance: SidebarSplitViewAppearance, onError: SettingsWindowBaseProps["onError"], contentReadyInitially: boolean) {
  const errorRef = useRef(onError); errorRef.current = onError;
  const active = useRef(false);
  const contentReady = useRef(contentReadyInitially);
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
    void import("@legendapp/spark-desktop-windows/src/window-manager").then(async windows => {
      if (!active.current) { shown.current = false; return; }
      await windows.showWindow(windowId);
    }).catch(cause => { shown.current = false; report(cause); });
  }, [report, windowId]);
  useEffect(() => { active.current = true; showIfReady(); return () => { active.current = false; }; }, [showIfReady]);
  useEffect(() => {
    let current = true;
    void import("@legendapp/spark-desktop-windows/src/window-manager").then(async windows => {
      if (current) await windows.setWindowOptions(windowId, { title, windowStyle: { appearance } });
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

export function SettingsWindow<PageId extends string = string>(props: SettingsWindowProps<PageId>) {
  const { appearance = "system", backgroundClassName = "bg-background", contentBackgroundClassName = backgroundClassName, contentMinWidth = 340, pages, sidebarMinWidth = 180, windowId, onError } = props;
  const { selected, requestSelection } = useSettingsSelection(props);
  const page = pages.find(page => page.id === selected)!;
  const { onResize, report } = useSettingsWindow(windowId, page.title, appearance, onError, true);
  return <SidebarSplitView appearance={appearance} className={cn("flex-1", backgroundClassName)} contentMinWidth={contentMinWidth} onResize={onResize} onError={report} sidebarMinWidth={sidebarMinWidth} style={styles.root}
    sidebar={<View className="min-w-0 flex-1 overflow-hidden" style={styles.pane}>
      <SettingsSidebar onSelectionChange={requestSelection} pages={pages} selectedPageId={selected} />
      <SettingsToolbarBackground variant="sidebar" />
    </View>}
    content={<View className={cn("min-w-0 flex-1 overflow-hidden", contentBackgroundClassName)} style={styles.pane}>
      {page.render()}<SettingsToolbarBackground variant="content" />
    </View>}
  />;
}

export function VirtualizedSettingsWindow<PageId extends string = string>(props: VirtualizedSettingsWindowProps<PageId>) {
  const { appearance = "system", backgroundClassName = "bg-background", contentBackgroundClassName = backgroundClassName, contentMinWidth = 340, estimatedItemSize = 520, pages, sidebarMinWidth = 180, windowId, onError } = props;
  if (!Number.isFinite(estimatedItemSize) || estimatedItemSize <= 0) throw new SparkError("E_INVALID_ARGUMENT", "estimatedItemSize must be positive");
  const { selected, requestSelection, revision } = useSettingsSelection(props);
  const listRef = useRef<LegendListRef | null>(null);
  const page = pages.find(page => page.id === selected)!;
  const { onResize, markContentReady, report } = useSettingsWindow(windowId, page.title, appearance, onError, false);
  const programmatic = useRef(0);
  const visiblePage = useRef<PageId | undefined>(undefined);
  const initialized = useRef(false);
  const pageIndexById = useMemo(() => new Map(pages.map((page, index) => [page.id, index])), [pages]);
  useEffect(() => {
    let current = true;
    const generation = ++programmatic.current;
    const frame = requestAnimationFrame(() => {
      if (visiblePage.current === selected && initialized.current) { programmatic.current = 0; return; }
      const list = listRef.current;
      if (!list) { report(new SparkError("E_UNAVAILABLE", "Settings list is not mounted")); return; }
      void list.scrollToIndex({ animated: initialized.current, index: pageIndexById.get(selected)!, viewOffset: SETTINGS_TITLEBAR_CONTENT_INSET, viewPosition: 0 })
        .then(() => { if (current) visiblePage.current = selected; })
        .catch(cause => { if (current) report(cause); })
        .finally(() => {
          if (!current) return;
          initialized.current = true;
          if (programmatic.current === generation) programmatic.current = 0;
          markContentReady();
        });
    });
    return () => { current = false; cancelAnimationFrame(frame); };
  }, [markContentReady, pageIndexById, report, revision, selected]);
  const onFirstVisibleItemChanged = useCallback((info: { index: number }) => {
    if (programmatic.current) return;
    const state = listRef.current?.getState();
    let index = info.index;
    if (state) {
      const visibleTop = state.scroll + SETTINGS_TITLEBAR_CONTENT_INSET;
      while (index < pages.length - 1 && state.positionAtIndex(index) + state.sizeAtIndex(index) <= visibleTop) index++;
    }
    const page = pages[index];
    if (page && visiblePage.current !== page.id) {
      visiblePage.current = page.id;
      requestSelection(page.id);
    }
  }, [pages, requestSelection]);
  const onScroll = useCallback(() => {
    const state = listRef.current?.getState();
    if (state) onFirstVisibleItemChanged({ index: state.start });
  }, [onFirstVisibleItemChanged]);
  const renderItem = useCallback(({ index, item }: LegendListRenderItemProps<SettingsWindowPage<PageId>>) => (
    <View className="flex-col gap-5" style={[styles.virtualizedSettingsListPage, index > 0 && styles.virtualizedSettingsListPageAfterFirst]}>
      <View className="flex-col gap-2"><Text className="text-xl font-semibold text-text-primary leading-tight">{item.title}</Text></View>
      <View className="flex-col">{item.render()}</View>
    </View>
  ), []);
  return <SidebarSplitView appearance={appearance} className={cn("flex-1", backgroundClassName)} contentMinWidth={contentMinWidth} onResize={onResize} onError={report} sidebarMinWidth={sidebarMinWidth} style={styles.root}
    sidebar={<View className="min-w-0 flex-1 overflow-hidden" style={styles.pane}>
      <SettingsSidebar onSelectionChange={requestSelection} pages={pages} selectedPageId={selected} /><SettingsToolbarBackground variant="sidebar" />
    </View>}
    content={<View className={cn("min-w-0 flex-1 overflow-hidden", contentBackgroundClassName)} style={styles.pane}>
      <LegendList contentInset={settingsContentInset} contentContainerStyle={styles.virtualizedSettingsListContent} data={pages} estimatedItemSize={estimatedItemSize} keyExtractor={settingsPageKey} onFirstVisibleItemChanged={onFirstVisibleItemChanged} onScroll={onScroll} scrollEventThrottle={16} ref={listRef} renderItem={renderItem} recycleItems style={styles.virtualizedSettingsList} />
      <SettingsToolbarBackground variant="content" />
    </View>}
  />;
}
const settingsPageKey = (page: SettingsWindowPage) => page.id;

function SettingsToolbarBackground({ variant }: { variant: "content" | "sidebar" }) {
  return (
    <View
      className="absolute left-0 right-0 top-0 bg-gradient-to-b from-background-primary from-60% to-background-primary/0"
      pointerEvents="none"
      style={[styles.toolbarBackground, variant === "sidebar" ? styles.sidebarToolbarBackground : undefined]}
    />
  );
}

export type SettingsSidebarProps<PageId extends string = string> = {
  onSelectionChange: (pageId: PageId) => void;
  pages: readonly Pick<SettingsWindowPage<PageId>, "id" | "title">[];
  selectedPageId: PageId;
};

export function SettingsSidebar<PageId extends string = string>({
  onSelectionChange,
  pages,
  selectedPageId,
}: SettingsSidebarProps<PageId>) {
  return (
    <View className="flex-1 min-h-0">
      <ScrollView
        className="flex-1"
        contentContainerStyle={styles.sidebarContent}
        showsVerticalScrollIndicator={false}
      >
        {pages.map((page) => {
          const isSelected = selectedPageId === page.id;

          return (
            <Pressable
              {...settingsSidebarPressablePlatformProps}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              collapsable={false}
              style={styles.sidebarRow}
              className={cn(
                "justify-center rounded-md px-2",
                isSelected ? "bg-primary/15" : "hover:bg-background-secondary/60 active:bg-background-secondary",
              )}
              key={page.id}
              onPress={() => onSelectionChange(page.id)}
            >
              <Text
                className={isSelected ? "text-sm font-medium text-text-primary" : "text-sm text-text-secondary"}
                numberOfLines={1}
              >
                {page.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export interface SettingsPageProps {
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

export function SettingsPage({ actions, children, contentClassName }: SettingsPageProps) {
  return (
    <View className="w-full flex-1 self-stretch overflow-hidden">
      {actions ? <View className="flex-row justify-end px-6 pt-4">{actions}</View> : null}
      <ScrollView
        className="flex-1"
        contentContainerClassName={cn("w-full max-w-4xl flex-col self-center px-8 pb-7", contentClassName)}
        contentInset={settingsContentInset}
        horizontal={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export interface SettingsSectionProps {
  card?: boolean;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  description?: string;
  first?: boolean;
  headerRight?: ReactNode;
  title?: string | null;
}

export function SettingsSection({
  card = true,
  children,
  className,
  contentClassName,
  description,
  first = false,
  headerRight,
  title,
}: SettingsSectionProps) {
  const containerClassName = cn("flex flex-col gap-3", !first && "mt-7", className);
  const hasHeader = Boolean(title || description || headerRight);
  const contentNode = children !== undefined && children !== null
    ? card
      ? <SettingsRowGroup className={contentClassName}>{children}</SettingsRowGroup>
      : <View className={cn("flex flex-col gap-4", contentClassName)}>{children}</View>
    : null;

  return (
    <View className={containerClassName}>
      {hasHeader ? (
        <View className="flex-row items-start justify-between gap-4">
          <View className="flex-1 flex-col gap-1">
            {title ? (
              <Text className="text-sm font-semibold leading-tight text-text-secondary">{title}</Text>
            ) : null}
            {description ? (
              <Text className="text-xs leading-relaxed text-text-secondary">{description}</Text>
            ) : null}
          </View>
          {headerRight ? <View className="flex-none ml-4">{headerRight}</View> : null}
        </View>
      ) : null}
      {contentNode}
    </View>
  );
}

export interface SettingsCardProps {
  children: ReactNode;
  className?: string;
}

export function SettingsCard({ children, className }: SettingsCardProps) {
  return (
    <View className={cn("overflow-hidden rounded-xl border border-border-primary bg-background-secondary/20", className)}>
      {children}
    </View>
  );
}

export interface SettingsRowGroupProps {
  children: ReactNode;
  className?: string;
}

export function SettingsRowGroup({ children, className }: SettingsRowGroupProps) {
  return (
    <SettingsRowGroupContext.Provider value>
      <SettingsCard className={className}>{children}</SettingsCard>
    </SettingsRowGroupContext.Provider>
  );
}

export interface SettingsRowProps {
  align?: "start" | "center";
  className?: string;
  contentClassName?: string;
  control: ReactNode;
  controlWrapperClassName?: string;
  description?: string;
  /** Visual emphasis only. Disable the control itself when needed. */
  muted?: boolean;
  title: string;
}

export function SettingsRow({
  align = "start",
  className,
  contentClassName,
  control,
  controlWrapperClassName,
  description,
  muted = false,
  title,
}: SettingsRowProps) {
  const grouped = useContext(SettingsRowGroupContext);

  return (
    <View
      className={cn(
        "flex-row justify-between gap-5 px-4 py-4",
        align === "center" ? "items-center" : "items-start",
        grouped ? "border-border-primary" : "",
        muted ? "opacity-60" : "",
        className,
      )}
      style={grouped ? styles.groupedRow : undefined}
    >
      <View className={cn("min-w-0 flex-1 flex-col gap-1 pr-6", contentClassName)}>
        <Text className="text-sm font-semibold leading-tight text-text-primary">{title}</Text>
        {description ? (
          <Text className="text-xs leading-relaxed text-text-secondary">{description}</Text>
        ) : null}
      </View>
      <View className={cn("max-w-full flex-shrink items-end", controlWrapperClassName)}>
        {control}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
    minWidth: 0,
  },
  root: {
    flex: 1,
  },
  virtualizedSettingsList: {
    flex: 1,
  },
  virtualizedSettingsListContent: {
    flexDirection: "column",
    paddingBottom: 28,
  },
  // Keep horizontal sizing inside the item, so the virtualized scroll content
  // cannot add its padding to the measured page width and clip the controls.
  virtualizedSettingsListPage: {
    alignSelf: "center",
    maxWidth: 896,
    paddingHorizontal: 32,
    width: "100%",
  },
  virtualizedSettingsListPageAfterFirst: {
    marginTop: 40,
  },
  groupedRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Selection adds a background to an otherwise flattenable row. Keep its native
  // bounds stable and clip painting when Fabric updates selection during scroll.
  sidebarRow: {
    height: 28,
    flexShrink: 0,
    overflow: "hidden",
  },
  sidebarContent: {
    paddingHorizontal: 8,
    paddingTop: SETTINGS_SIDEBAR_TOP_INSET,
  },
  sidebarToolbarBackground: {
    height: SETTINGS_SIDEBAR_TOP_INSET,
  },
  toolbarBackground: {
    height: SETTINGS_TITLEBAR_CONTENT_INSET,
    zIndex: 1,
  },
});
