import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { DataProvider, LayoutProvider, RecyclerListView } from "recyclerlistview";

// Test IDs: component-library-recyclerlistview-row-<index> for rendered rows.
const ID = "component-library-recyclerlistview";

/** recyclerlistview: 500 fixed-height rows recycled inside a sized viewport. */
export function RecyclerListViewDemo() {
  const [width, setWidth] = useState(0);
  const dataProvider = useMemo(() => new DataProvider((a, b) => a !== b).cloneWithRows(Array.from({ length: 500 }, (_, index) => index)), []);
  const layoutProvider = useMemo(() => new LayoutProvider(() => 0, (_type, dimension) => { dimension.width = width; dimension.height = 40; }), [width]);
  return <View className="flex-1 bg-background p-6 gap-3" onLayout={event => setWidth(event.nativeEvent.layout.width - 48)}>
    <Text className="text-sm text-muted">500 rows; only the visible ones are rendered and recycled while scrolling.</Text>
    {width > 0 && <RecyclerListView style={{ flex: 1 }} dataProvider={dataProvider} layoutProvider={layoutProvider}
      rowRenderer={(_type, index: number) => <View testID={`${ID}-row-${index}`} style={{ height: 40, justifyContent: "center", paddingHorizontal: 12, borderBottomWidth: 1, borderColor: "#e5e7eb" }}>
        <Text className="text-foreground">{`Row ${index}`}</Text>
      </View>} />}
  </View>;
}
