import { ScrollView, Text } from "react-native";
import { IsScreenRounded, ScreenCornerRadius } from "react-native-screen-corner-radius";

// Test ID: displays-graphics-screen-corner-radius-<radius>-<rounded>, e.g. -0-false on a Mac.
const ID = "displays-graphics-screen-corner-radius";

/** react-native-screen-corner-radius's constants; its native module is iOS only. */
export function ScreenCornerRadiusDemo() {
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">The display's corner radius, for matching rounded screen corners on iPhone. Desktop displays report 0.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${ScreenCornerRadius}-${IsScreenRounded}`}>{`radius ${ScreenCornerRadius}, rounded ${IsScreenRounded}`}</Text>
  </ScrollView>;
}
