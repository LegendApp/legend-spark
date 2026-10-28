import { useEffect } from "react";
import { Text, View } from "react-native";
import { Link, Stack, useRouter } from "expo-router";

// Test ID: component-library-expo-router-home; opening it pushes /details/42.
export default function Home() {
  const router = useRouter();
  useEffect(() => { router.push("/details/42?from=home"); }, [router]);
  return <View className="flex-1 gap-3 p-6">
    <Stack.Screen options={{ title: "Home" }} />
    <Text className="text-foreground" testID="component-library-expo-router-home">Home route</Text>
    <Link href="/details/7" className="text-accent">Open details 7</Link>
  </View>;
}
