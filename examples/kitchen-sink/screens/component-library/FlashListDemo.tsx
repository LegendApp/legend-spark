import { useState } from "react";
import { Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";

// Test IDs: component-library-flash-list-loaded after onLoad; rows are -row-<index>.
const ID = "component-library-flash-list";
const data = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), height: 32 + (index % 4) * 12 }));

/** @shopify/flash-list v2: a recycled list of 1,000 rows with varying heights. */
export function FlashListDemo() {
  const [loaded, setLoaded] = useState(false);
  const [viewable, setViewable] = useState(0);
  return <View className="flex-1 bg-background p-6 gap-3">
    <Text className="font-mono text-xs text-foreground" testID={loaded ? `${ID}-loaded` : undefined}>{`loaded ${loaded}, viewable ${viewable}`}</Text>
    <FlashList data={data} keyExtractor={item => item.id} onLoad={() => setLoaded(true)}
      onViewableItemsChanged={({ viewableItems }) => setViewable(viewableItems.length)}
      renderItem={({ item, index }) => <View testID={`${ID}-row-${index}`} style={{ height: item.height, justifyContent: "center", paddingHorizontal: 12, borderBottomWidth: 1, borderColor: "#e5e7eb" }}>
        <Text className="text-foreground">{`Row ${index}`}</Text>
      </View>} />
  </View>;
}
