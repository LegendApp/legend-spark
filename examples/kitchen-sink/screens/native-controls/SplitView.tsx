import { SidebarSplitView } from "@legendapp/spark/ui/split-view";
import { SFSymbol } from "@legendapp/spark/ui/symbol";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

const items = [
  { id: "overview", symbol: "square.grid.2x2", title: "Overview" },
  { id: "split-view", symbol: "sidebar.left", title: "Split View" },
  { id: "sidebar", symbol: "list.bullet", title: "Sidebar" },
  { id: "liquid-glass", symbol: "sparkles", title: "Liquid Glass" },
];

export function SplitView() {
  const [selected, setSelected] = useState("split-view");
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  return <SidebarSplitView testID="native-controls-split-view-view" style={{ flex: 1 }} contentMinWidth={320} sidebarMinWidth={180}
    inspectorCollapsed={inspectorCollapsed} onInspectorCollapsedChange={setInspectorCollapsed} inspectorWidth={240}
    inspector={<View className="flex-1 gap-2 bg-surface p-4" testID="native-controls-split-view-inspector">
      <Text className="text-lg font-bold text-foreground" accessibilityRole="header">Inspector</Text>
      <Text className="text-sm text-muted">A trailing AppKit inspector item. Drag its divider or collapse it from here.</Text>
    </View>}
    sidebar={<View className="flex-1 gap-1 bg-surface px-3 pt-4" testID="native-controls-split-view-sidebar">
      <Text className="mb-3 text-xl font-bold text-foreground" accessibilityRole="header">Sidebar</Text>
      {items.map(item => <Pressable key={item.id} onPress={() => setSelected(item.id)} className={`min-h-8 flex-row items-center gap-2 rounded-md px-2 ${item.id === selected ? "bg-highlight" : ""}`}>
        <SFSymbol name={item.symbol} size={14} />
        <Text className="text-sm font-semibold text-foreground">{item.title}</Text>
      </Pressable>)}
    </View>}
    content={<View className="flex-1 justify-center gap-2 bg-background p-7" testID="native-controls-split-view-content">
      <Text className="text-2xl font-bold text-foreground" accessibilityRole="header">Main content</Text>
      <Text className="text-sm text-muted">Both split view panes are rendered from React content.</Text>
      <Pressable onPress={() => setInspectorCollapsed(collapsed => !collapsed)} className="self-start rounded-md bg-highlight px-3 py-1" testID="native-controls-split-view-toggle-inspector">
        <Text className="text-sm font-semibold text-foreground">{inspectorCollapsed ? "Show Inspector" : "Hide Inspector"}</Text>
      </Pressable>
    </View>} />;
}
