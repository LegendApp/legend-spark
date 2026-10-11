import { GlassView } from "@legendapp/spark/ui/glass";
import { Text, View } from "react-native";

export function Glass() {
  return <View className="flex-1 items-center justify-center bg-highlight">
    <GlassView testID="native-controls-glass-view" glassStyle="regular" style={{ alignItems: "center", justifyContent: "center", gap: 10, width: 320, height: 180, borderRadius: 10, overflow: "hidden" }}>
      <Text className="text-lg font-bold text-foreground">Glass effect view</Text>
      <Text className="text-sm text-muted">Native visual effect container</Text>
    </GlassView>
  </View>;
}
