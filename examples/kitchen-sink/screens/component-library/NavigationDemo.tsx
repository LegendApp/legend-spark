import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { DarkTheme, NavigationContainer, NavigationIndependentTree, useNavigation, type NavigationProp } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

// Test IDs (component-library-navigation-…): stack-header-<title> is the stack's header title; stack-<screen>
// is a stack screen's content; stack-done after Home → Details → back; tab-<name> is the visible tab.
const ID = "component-library-navigation";
type StackParams = { Home: undefined; Details: undefined };
const Stack = createNativeStackNavigator<StackParams>();
const Tabs = createBottomTabNavigator();

function StackPage({ name, onDone }: { name: keyof StackParams; onDone: () => void }) {
  const navigation = useNavigation<NavigationProp<StackParams>>();
  const [visits, setVisits] = useState(0);
  useEffect(() => navigation.addListener("focus", () => setVisits(count => count + 1)), [navigation]);
  useEffect(() => {
    if (name === "Home" && visits === 1) setTimeout(() => navigation.navigate("Details"), 300);
    if (name === "Details" && visits === 1) setTimeout(() => navigation.goBack(), 300);
    if (name === "Home" && visits === 2) onDone();
  }, [name, visits, navigation, onDone]);
  return <View style={{ padding: 16 }}><Text className="text-foreground" testID={`${ID}-stack-${name}`}>{`${name} (visit ${visits})`}</Text></View>;
}

// The test ID appears only once the title has a size, so a header that never lays out fails the flow.
function HeaderTitle({ title }: { title: string }) {
  const [laidOut, setLaidOut] = useState(false);
  return <Text className="text-foreground" onLayout={event => setLaidOut(event.nativeEvent.layout.height > 0)} testID={laidOut ? `${ID}-stack-header-${title}` : undefined}>{title}</Text>;
}

function TabPage({ name }: { name: string }) {
  const navigation = useNavigation<NavigationProp<Record<string, undefined>>>();
  useEffect(() => { if (name === "First") setTimeout(() => navigation.navigate("Second"), 300); }, [name, navigation]);
  return <View style={{ padding: 16 }}><Text className="text-foreground" testID={`${ID}-tab-${name}`}>{`${name} tab`}</Text></View>;
}

/** React Navigation through its own API: native stack and bottom tabs. */
export function NavigationDemo() {
  const [done, setDone] = useState(false);
  return <View style={{ flex: 1, padding: 24, gap: 12 }}>
    <View style={{ height: 220, borderWidth: 1, borderColor: "#888", borderRadius: 8, overflow: "hidden" }}>
      <NavigationIndependentTree><NavigationContainer theme={DarkTheme}>
        <Stack.Navigator screenOptions={{ headerTitle: ({ children }) => <HeaderTitle title={children} /> }}>
          <Stack.Screen name="Home">{() => <StackPage name="Home" onDone={() => setDone(true)} />}</Stack.Screen>
          <Stack.Screen name="Details">{() => <StackPage name="Details" onDone={() => setDone(true)} />}</Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer></NavigationIndependentTree>
    </View>
    <View style={{ height: 180, borderWidth: 1, borderColor: "#888", borderRadius: 8, overflow: "hidden" }}>
      <NavigationIndependentTree><NavigationContainer theme={DarkTheme}>
        <Tabs.Navigator>
          <Tabs.Screen name="First">{() => <TabPage name="First" />}</Tabs.Screen>
          <Tabs.Screen name="Second">{() => <TabPage name="Second" />}</Tabs.Screen>
        </Tabs.Navigator>
      </NavigationContainer></NavigationIndependentTree>
    </View>
    <Text className="font-mono text-xs text-foreground" testID={done ? `${ID}-stack-done` : undefined}>{done ? "stack: Home → Details → back" : "stack: navigating…"}</Text>
  </View>;
}
