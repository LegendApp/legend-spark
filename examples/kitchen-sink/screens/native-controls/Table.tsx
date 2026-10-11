import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Outline, Table, getTableAvailability } from "@legendapp/spark/ui/table";
import type { SparkError } from "@legendapp/spark/contracts";
import { Boundary, describe } from "./ControlPrimitives";
import { describeIds, useOutlineDemo, useTableDemo } from "./table-demo";
import { useTableMessages } from "./table-messages";

// Test IDs: native-controls-<screen>-list for the view, native-controls-<screen>-<readout> for JSON readouts.
const frame = { flex: 1, minHeight: 240 } as const;

function Screen({ screen, title, hint, readouts, children }: { screen: string; title: string; hint: string; readouts: Record<string, [label: string, value: string]>; children: (onError: (error: SparkError) => void) => ReactNode }) {
  const t = useTableMessages();
  const [error, setError] = useState<string>();
  const rows = { availability: [t.readouts.availability, JSON.stringify(getTableAvailability())], ...readouts };
  return <View className="flex-1 gap-3 bg-background p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{title}</Text>
    <Text className="text-sm text-muted">{hint}</Text>
    <View className="gap-1">
      {Object.entries(rows).map(([key, [label, value]]) => <View key={key} className="flex-row gap-2">
        <Text className="w-28 text-xs font-semibold text-muted">{label}</Text>
        <Text selectable numberOfLines={1} className="flex-1 font-mono text-xs text-muted" testID={`native-controls-${screen}-${key}`}>{value}</Text>
      </View>)}
      {error && <Text selectable className="text-xs text-danger" testID={`native-controls-${screen}-error`}>{error}</Text>}
    </View>
    <Boundary id={`native-controls-${screen}-list`}>{children(reported => setError(describe(reported)))}</Boundary>
  </View>;
}

export function TableScreen() {
  const t = useTableMessages();
  const { props, event } = useTableDemo();
  return <Screen screen="table" title={t.tableTitle} hint={t.tableHint} readouts={{
    selection: [t.readouts.selection, describeIds(props.selectedIds)],
    sort: [t.readouts.sort, JSON.stringify(props.sort)],
    columns: [t.readouts.columns, JSON.stringify(props.columnLayout)],
    event: [t.readouts.event, event],
  }}>{onError => <Table {...props} testID="native-controls-table-list" accessibilityLabel={t.tableTitle} style={frame} onError={onError} />}</Screen>;
}

export function OutlineScreen() {
  const t = useTableMessages();
  const { props, columnLayout, event } = useOutlineDemo();
  return <Screen screen="outline" title={t.outlineTitle} hint={t.outlineHint} readouts={{
    selection: [t.readouts.selection, describeIds(props.selectedIds)],
    expanded: [t.readouts.expanded, JSON.stringify(props.expandedIds)],
    columns: [t.readouts.columns, columnLayout],
    event: [t.readouts.event, event],
  }}>{onError => <Outline {...props} testID="native-controls-outline-list" accessibilityLabel={t.outlineTitle} style={frame} onError={onError} />}</Screen>;
}
