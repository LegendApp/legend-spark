import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Portal, PortalHost, PortalProvider } from "@gorhom/portal";

// Test IDs: component-library-portal-host holds the teleported -content once it lays out inside the host.
const ID = "component-library-portal";

/** @gorhom/portal: content declared in one place renders inside a named host elsewhere in the tree. */
export function PortalDemo() {
  const [mounted, setMounted] = useState(false);
  return <PortalProvider><ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">The box below is declared in the first section and rendered by the host in the second.</Text>
    <View className="rounded-lg border border-border p-3"><Text className="text-foreground">Source section</Text>
      <Portal hostName="kitchen-sink-host"><View onLayout={() => setMounted(true)} style={{ padding: 12, borderRadius: 8, backgroundColor: "#8b5cf6" }}>
        <Text style={{ color: "white" }} testID={mounted ? `${ID}-content` : undefined}>Teleported content</Text>
      </View></Portal>
    </View>
    <View testID={`${ID}-host`} className="rounded-lg border border-border p-3"><Text className="text-foreground">Host section</Text><PortalHost name="kitchen-sink-host" /></View>
  </ScrollView></PortalProvider>;
}
