import { Text, View } from "react-native";
import { useWorkspacesMessages } from "./workspaces-messages";

/** An editor or the inspector of Multiwindow > Workspaces: its label, which restored workspaces keep in its props. */
export function WorkspaceWindow({ label }: { label: string }) {
  const t = useWorkspacesMessages();
  return <View className="flex-1 gap-2 bg-background p-5" testID={`multiwindow-workspaces-window-content-${label}`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{label === "I" ? t.inspector : t.editor(label)}</Text>
    <Text className="text-sm text-muted">{t.windowText}</Text>
  </View>;
}
