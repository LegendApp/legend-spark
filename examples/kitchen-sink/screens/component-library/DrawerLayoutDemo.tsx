import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Drawer } from "react-native-drawer-layout";
import { GestureHandlerRootView } from "react-native-gesture-handler";

// Test IDs: component-library-drawer-layout-opened and -closed after the drawer opens, then closes again.
const ID = "component-library-drawer-layout";

/** react-native-drawer-layout through its own API, on Reanimated and Gesture Handler. */
export function DrawerLayoutDemo() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => {
    const opening = setTimeout(() => setOpen(true), 300);
    const closing = setTimeout(() => setOpen(false), 1500);
    return () => { clearTimeout(opening); clearTimeout(closing); };
  }, []);
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <Drawer open={open} onOpen={() => { setOpen(true); setEvents(previous => [...previous, "opened"]); }} onClose={() => { setOpen(false); setEvents(previous => [...previous, "closed"]); }}
      drawerStyle={{ backgroundColor: "#1e293b" }} renderDrawerContent={() => <View style={{ padding: 24 }}><Text style={{ color: "white" }}>Drawer content</Text></View>}>
      <View style={{ flex: 1, padding: 24, gap: 8 }}>
        <Text className="text-foreground">Opens after 0.3 s and closes after 1.5 s.</Text>
        {events.map((event, index) => <Text key={index} className="font-mono text-xs text-foreground" testID={`${ID}-${event}`}>{event}</Text>)}
      </View>
    </Drawer>
  </GestureHandlerRootView>;
}
