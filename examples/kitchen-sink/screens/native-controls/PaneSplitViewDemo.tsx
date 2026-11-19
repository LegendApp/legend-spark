import { useState } from "react";
import { Text, View } from "react-native";
import { SegmentedControl } from "@legendapp/spark/ui";
import { SidebarSplitView, SplitView, type SplitViewPane, type SplitViewProps } from "@legendapp/spark/ui/split-view";
import { Status, errorText } from "../../Panel";

const styles = [
  { value: "thin", label: "Thin" },
  { value: "thick", label: "Thick" },
  { value: "paneSplitter", label: "Pane splitter" },
] as const;

function Pane({ title, detail, testID }: { title: string; detail: string; testID?: string }) {
  return <View className="flex-1 justify-center gap-1 bg-surface p-4" testID={testID}>
    <Text accessibilityRole="header" className="font-semibold text-foreground">{title}</Text>
    <Text className="text-sm text-muted">{detail}</Text>
  </View>;
}

const verticalPanes: readonly SplitViewPane[] = [
  { id: "preview", initialSize: 170, minSize: 100, maxSize: 220, content: <Pane testID="pane-split-view-preview" title="Preview" detail="Drag the horizontal divider." /> },
  { id: "output", minSize: 60, content: <Pane testID="pane-split-view-output" title="Output" detail="Takes the remaining height." /> },
];

function VerticalPanes() {
  const [sizes, setSizes] = useState<readonly number[]>([]);
  return <View className="flex-1 bg-background">
    <SplitView testID="pane-split-view-vertical" style={{ flex: 1 }} orientation="vertical" dividerStyle="paneSplitter" panes={verticalPanes} onResize={setSizes} />
    <Status testID="pane-split-view-heights">Heights: {sizes.map(Math.round).join(" / ")}</Status>
  </View>;
}

const horizontalPanes: readonly SplitViewPane[] = [
  { id: "files", initialSize: 160, minSize: 100, maxSize: 230, content: <Pane testID="pane-split-view-files" title="Files" detail="100–230 pt wide" /> },
  { id: "workspace", minSize: 160, content: <VerticalPanes /> },
  { id: "details", initialSize: 150, minSize: 100, maxSize: 220, content: <Pane testID="pane-split-view-details" title="Details" detail="100–220 pt wide" /> },
];

function Detail() {
  const [style, setStyle] = useState<NonNullable<SplitViewProps["dividerStyle"]>>("thin");
  const [sizes, setSizes] = useState<readonly number[]>([]);
  const [error, setError] = useState("");
  return <View className="flex-1 gap-2 bg-background p-4">
    <SegmentedControl testID="pane-split-view-style" accessibilityLabel="Divider style" options={styles} value={style} onValueChange={value => {
      if (value === "thin" || value === "thick" || value === "paneSplitter") setStyle(value);
    }} />
    <SplitView testID="pane-split-view-horizontal" style={{ flex: 1 }} panes={horizontalPanes} dividerStyle={style} onResize={setSizes} onError={value => setError(errorText(value))} />
    <Status testID="pane-split-view-widths">{error || `Widths: ${sizes.map(Math.round).join(" / ")}`}</Status>
  </View>;
}

export function PaneSplitViewDemo() {
  return <SidebarSplitView style={{ flex: 1 }} contentMinWidth={360}
    sidebar={<Pane title="Sidebar" detail="The split view lives in the detail pane." />}
    content={<Detail />} />;
}
