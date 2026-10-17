import { Text, View } from "react-native";
import { DragDropView } from "@legendapp/spark/drag-drop";
import { NOTES_TYPE, activateInspector, dragFeatures, dropOnInspector, useChoreographyState } from "./window-choreography";
import { useChoreographyMessages } from "./choreography-messages";

/**
 * The inspector window: it shows the item selected in the main window's list, so it follows the selection. It takes the
 * notes panel dropped on it, and a drag of the panel that hovers over it brings its window forward (spring loading, macOS).
 */
export function ChoreographyInspector() {
  const t = useChoreographyMessages();
  const { selected } = useChoreographyState();
  return <DragDropView style={{ flex: 1 }} acceptedTypes={[NOTES_TYPE]} onDrop={({ data }) => dropOnInspector(data?.[NOTES_TYPE])} testID="multiwindow-choreography-inspector-drop"
    {...(dragFeatures().springLoading ? { springLoading: true, onSpringLoad: activateInspector } : {})}>
    <View className="flex-1 gap-2 bg-background p-5" testID="multiwindow-choreography-inspector">
      <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.inspector}</Text>
      <Text className="text-foreground" testID={`multiwindow-choreography-inspector-item-${selected}`}>{t.items[selected]}</Text>
    </View>
  </DragDropView>;
}
