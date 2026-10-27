import { useState } from "react";
import { Text, View } from "react-native";
import { Screen, ScreenContainer, ScreenStack, screensEnabled } from "react-native-screens";
import { Button } from "../../Controls";

// Test IDs: component-library-screens-<name>-visible for the screens React lays out (the hidden one has
// display: none, so it never reports a layout). The button activates the second screen by hand.
const ID = "component-library-screens";

function Page({ name, onShown }: { name: string; onShown: (name: string) => void }) {
  return <View style={{ padding: 12 }} onLayout={event => event.nativeEvent.layout.height > 0 && onShown(name)}>
    <Text className="text-foreground">{`Screen ${name}`}</Text>
  </View>;
}

/** react-native-screens components; on macOS Spark's patch uses their web (plain view) implementations. */
export function ScreensDemo() {
  const [active, setActive] = useState<"first" | "second">("first");
  const [shown, setShown] = useState<string[]>([]);
  const show = (name: string) => setShown(previous => previous.includes(name) ? previous : [...previous, name]);
  return <View style={{ padding: 24, gap: 12 }}>
    <Text className="text-sm text-muted">{`Native screens enabled: ${screensEnabled()}`}</Text>
    <ScreenContainer style={{ height: 80, borderWidth: 1, borderColor: "#888" }}>
      {(["first", "second"] as const).map(name => <Screen key={name} enabled activityState={active === name ? 2 : 0} style={{ position: "absolute", inset: 0 }}>
        <Page name={name} onShown={show} />
      </Screen>)}
    </ScreenContainer>
    <ScreenStack style={{ height: 60, borderWidth: 1, borderColor: "#888" }}>
      <Screen enabled activityState={2} style={{ position: "absolute", inset: 0 }}><Page name="stack" onShown={show} /></Screen>
    </ScreenStack>
    <Button onPress={() => setActive("second")}>Activate the second screen</Button>
    {shown.map(name => <Text key={name} className="font-mono text-xs text-foreground" testID={`${ID}-${name}-visible`}>{`${name} visible`}</Text>)}
  </View>;
}
