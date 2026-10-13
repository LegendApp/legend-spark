import { Text, View } from "react-native";
import { useChoreographyState } from "./window-choreography";
import { useChoreographyMessages } from "./choreography-messages";

/** The inspector window: it shows the item selected in the main window's list, so it follows the selection. */
export function ChoreographyInspector() {
  const t = useChoreographyMessages();
  const { selected } = useChoreographyState();
  return <View className="flex-1 gap-2 bg-background p-5" testID="multiwindow-choreography-inspector">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.inspector}</Text>
    <Text className="text-foreground" testID={`multiwindow-choreography-inspector-item-${selected}`}>{t.items[selected]}</Text>
  </View>;
}
