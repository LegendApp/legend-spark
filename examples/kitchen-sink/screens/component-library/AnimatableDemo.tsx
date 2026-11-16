import { useState } from "react";
import { Text, View } from "react-native";
import * as Animatable from "react-native-animatable";

// Test IDs: component-library-animatable-ended-<n> after each finished animation.
const ID = "component-library-animatable";

/** react-native-animatable: declarative fadeInUp and bounce animations on React Native's Animated. */
export function AnimatableDemo() {
  const [ended, setEnded] = useState(0);
  return <View className="flex-1 bg-background p-6 gap-3">
    <Animatable.View animation="fadeInUp" duration={600} onAnimationEnd={() => setEnded(count => count + 1)} style={{ padding: 16, borderRadius: 8, backgroundColor: "#10b981" }}>
      <Text style={{ color: "white" }}>fadeInUp</Text>
    </Animatable.View>
    <Animatable.Text animation="bounce" duration={800} onAnimationEnd={() => setEnded(count => count + 1)} className="text-lg text-foreground">bounce</Animatable.Text>
    <Text className="font-mono text-xs text-foreground" testID={`${ID}-ended-${ended}`}>{`finished ${ended}`}</Text>
  </View>;
}
