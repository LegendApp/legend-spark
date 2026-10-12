import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { Observable } from "@legendapp/state";
import { useValue } from "@legendapp/state/react";
import { SidebarSplitView, type SidebarSplitViewResizeEvent } from "@legendapp/spark/ui/split-view";
import { useWindowState } from "@legendapp/spark/windows";
import { Button } from "../../Controls";
import { highlights, noteNumber, noteViews, type NoteView as View$ } from "./state";

const ITEMS = [1, 2, 3, 4, 5];
const LINES = Array.from({ length: 40 }, (_, index) => index + 1);

/**
 * A note window's restorable view: the selected item in the sidebar, the sidebar's width, the route and
 * the details list's scroll offset all live in `noteViews`, so sessions restore them and New Window
 * copies them. Each readout shows what the native view reports, not only the saved value.
 */
export function NoteView({ title, document }: { title: string; document: ReactNode }) {
  const view$ = useWindowState(noteViews);
  const route = useValue(view$.route), selected = useValue(view$.selected);
  const split = useSplitWidth(view$.split);
  const highlight = useValue(useWindowState(highlights));
  return <SidebarSplitView style={{ flex: 1 }} sidebarMinWidth={120} contentMinWidth={360} sidebarWidth={split.width} onResize={split.onResize}
    sidebar={<View className="flex-1 gap-1 bg-surface px-3 pt-4" testID="multiwindow-note-sidebar">
      <Text className="mb-2 text-sm font-semibold text-foreground" testID={`multiwindow-note-split-${split.actual ?? "pending"}`}>Sidebar {split.actual ?? "…"}</Text>
      {ITEMS.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === selected }} testID={`multiwindow-note-item-${item}`}
        onPress={() => view$.selected.set(item)} className={`rounded-md px-2 py-1 ${item === selected ? "bg-highlight" : ""}`}>
        <Text className="text-sm text-foreground">Item {item}</Text>
      </Pressable>)}
      <Text className="mt-2 text-xs text-muted" testID={`multiwindow-note-selected-${selected ?? "none"}`}>Selected: {selected ?? "none"}</Text>
    </View>}
    content={<View className="flex-1 gap-3 bg-background p-5">
      <Text className="text-xl font-bold text-foreground" testID="multiwindow-note-title">{title}</Text>
      <View className="flex-row gap-2">
        <Button testID="multiwindow-note-route-document" onPress={() => view$.route.set("document")}>Document</Button>
        <Button testID="multiwindow-note-route-details" onPress={() => view$.route.set("details")}>Details</Button>
      </View>
      <Text className="text-sm text-muted" testID={`multiwindow-note-route-is-${route}`}>Route: {route}</Text>
      {highlight && <Text className="text-sm text-foreground" testID={`multiwindow-note-highlight-${highlight.word}-from-${highlight.from === "main" ? "main" : noteNumber(highlight.from)}`}>Highlight “{highlight.word}” from {highlight.from}</Text>}
      {route === "document" ? document : <Details scroll$={view$.scrollY} />}
    </View>} />;
}

function Details({ scroll$ }: { scroll$: Observable<View$["scrollY"]> }) {
  const scroll = useRestoredScroll(scroll$);
  return <>
    <Text className="text-sm text-muted" testID={`multiwindow-note-scroll-${scroll.actual ?? "pending"}`}>Scrolled to {scroll.actual ?? "…"}</Text>
    <ScrollView ref={scroll.ref} className="flex-1 rounded-md border border-border" testID="multiwindow-note-details" scrollEventThrottle={16} onScroll={scroll.onScroll} onLayout={scroll.onLayout} onContentSizeChange={scroll.onContentSizeChange}>
      {LINES.map(line => <Text key={line} className="h-8 px-3 py-1 text-sm text-foreground">Line {line}</Text>)}
    </ScrollView>
  </>;
}

/** The sidebar width: the saved value drives the split view, and the width the split view reports is saved. */
function useSplitWidth(width$: Observable<number>) {
  const width = useValue(width$);
  const [actual, setActual] = useState<number | null>(null);
  const onResize = (event: SidebarSplitViewResizeEvent) => {
    if (event.phase !== "ready") return;
    const reported = Math.round(event.sidebarWidth);
    setActual(reported); width$.set(reported);
  };
  return { width, actual, onResize };
}

/**
 * Scrolls to the saved offset once the scroll view can reach it, and whenever the saved offset changes elsewhere;
 * saves the offsets the scroll view reports. Until a restored offset is reported back, other reports (the scroll
 * view settling at 0 before its content is mounted) are not saved over it.
 */
function useRestoredScroll(scroll$: Observable<number>) {
  const ref = useRef<ScrollView>(null), reported = useRef<number | null>(null);
  const pending = useRef<number | null>(scroll$.peek() > 0 ? scroll$.peek() : null), sizes = useRef({ layout: 0, content: 0 });
  const target = useValue(scroll$);
  const [actual, setActual] = useState<number | null>(null);
  useEffect(() => {
    if (pending.current === null && reported.current !== null && reported.current !== target) ref.current?.scrollTo({ y: target, animated: false });
  }, [target]);
  const report = (y: number) => { pending.current = null; reported.current = y; setActual(y); scroll$.set(y); };
  const sized = (change: Partial<typeof sizes.current>) => {
    Object.assign(sizes.current, change);
    const { layout, content } = sizes.current;
    if (!layout || !content) return;
    if (pending.current === null) { if (reported.current === null) report(0); return; }
    // Not laid out in its window yet: a first pass can size the scroll view to its whole content.
    if (layout >= content) return;
    // A saved offset past the end of the content restores to the end.
    pending.current = Math.min(pending.current, Math.round(content - layout));
    ref.current?.scrollTo({ y: pending.current, animated: false });
  };
  return {
    ref, actual,
    onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
      const y = Math.round(event.nativeEvent.contentOffset.y);
      if (pending.current === null || pending.current === y) report(y);
      // Scrolled before the content reached its size natively: ask again (a no-op once it cannot move further).
      else ref.current?.scrollTo({ y: pending.current, animated: false });
    },
    onLayout(event: LayoutChangeEvent) { sized({ layout: event.nativeEvent.layout.height }); },
    onContentSizeChange(_width: number, height: number) { sized({ content: height }); },
  };
}
