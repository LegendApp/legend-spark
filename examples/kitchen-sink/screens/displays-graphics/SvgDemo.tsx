import { useState } from "react";
import { ScrollView, Text, UIManager, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";

// Test IDs: displays-graphics-svg-native when the native SVG components are registered;
// displays-graphics-svg-laid-out once the canvas has a size.
const ID = "displays-graphics-svg";

/** react-native-svg through its own API; it supports macOS upstream. */
export function SvgDemo() {
  const [laidOut, setLaidOut] = useState(false);
  const native = ["RNSVGSvgView", "RNSVGPath", "RNSVGText"].every(name => UIManager.hasViewManagerConfig(name));
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted" testID={native ? `${ID}-native` : undefined}>{`Native SVG components registered: ${native ? "yes" : "no"}`}</Text>
    <View onLayout={event => setLaidOut(event.nativeEvent.layout.width > 0)}><Svg width={320} height={160} viewBox="0 0 320 160">
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#3b82f6" /><Stop offset="1" stopColor="#a855f7" /></LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={320} height={160} rx={16} fill="url(#sky)" />
      <Circle cx={60} cy={80} r={36} fill="#f59e0b" />
      <Path d="M120 120 L170 40 L220 120 Z" fill="#10b981" stroke="white" strokeWidth={3} />
      <SvgText x={240} y={88} fill="white" fontSize={18} fontWeight="bold">SVG</SvgText>
    </Svg></View>
    <Text className="font-mono text-xs text-foreground" testID={laidOut ? `${ID}-laid-out` : undefined}>{laidOut ? "laid out" : "…"}</Text>
  </ScrollView>;
}
