import { View } from "react-native";
import { ExpoRoot } from "expo-router";

// The routes live in ./expo-router; `location` starts the router at "/" instead of the Kitchen Sink's own
// launch URL. Test IDs come from the routes.
const routes = require.context("./expo-router", true, /\.tsx$/);

/** expo-router through its own API: file-based routes with a stack, a dynamic segment and search params. */
export function ExpoRouterDemo() {
  return <View className="flex-1 bg-background"><ExpoRoot context={routes} location="/" /></View>;
}
