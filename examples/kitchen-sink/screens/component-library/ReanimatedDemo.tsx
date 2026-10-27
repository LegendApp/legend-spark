import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming } from "react-native-reanimated";

// Test IDs: component-library-reanimated-finished once a 400 ms timing animation reports it finished at 1;
// component-library-reanimated-frames once frame callbacks have run on the UI thread.
const ID = "component-library-reanimated";

/** react-native-reanimated through its own API; it supports macOS upstream. */
export function ReanimatedDemo() {
  const progress = useSharedValue(0);
  const frames = useSharedValue(0);
  const [finished, setFinished] = useState<string>();
  const [frameCount, setFrameCount] = useState(0);
  useFrameCallback(() => {
    frames.value += 1;
    if (frames.value % 10 === 0) runOnJS(setFrameCount)(frames.value);
  });
  useEffect(() => {
    progress.value = withTiming(1, { duration: 400 }, done => { if (done) runOnJS(setFinished)(String(progress.value)); });
  }, [progress]);
  const box = useAnimatedStyle(() => ({ opacity: 0.2 + progress.value * 0.8, transform: [{ translateX: progress.value * 200 }] }));
  return <View style={{ padding: 24, gap: 12 }}>
    <Animated.View style={[{ width: 80, height: 80, borderRadius: 12, backgroundColor: "#3b82f6" }, box]} />
    <Text className="font-mono text-xs text-foreground" testID={finished === "1" ? `${ID}-finished` : undefined}>{`timing finished at ${finished ?? "…"}`}</Text>
    <Text className="font-mono text-xs text-foreground" testID={frameCount >= 10 ? `${ID}-frames` : undefined}>{`frame callbacks ${frameCount}`}</Text>
  </View>;
}
