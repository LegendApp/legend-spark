import { Text, View } from "react-native";
import { Stack, useLocalSearchParams, usePathname } from "expo-router";

// Test ID: component-library-expo-router-details-<id>-<from>.
export default function Details() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const pathname = usePathname();
  return <View className="flex-1 gap-3 p-6">
    <Stack.Screen options={{ title: `Details ${id}` }} />
    <Text className="text-foreground" testID={`component-library-expo-router-details-${id}-${from ?? "none"}`}>{`${pathname} from ${from ?? "none"}`}</Text>
  </View>;
}
