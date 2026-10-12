import { ScrollView, Text, View } from "react-native";
import { ActionButton } from "../../ActionButton";
import { FEATURES, availability, closeAllWindows, runStep, useWindowPerformance, type Paint } from "./window-performance";
import { usePerformanceMessages, type PerformanceMessages } from "./performance-messages";

const BUTTONS = ["prewarm", "warm", "cold", "close", "trim", "tight", "clock", "clock-hide", "clock-tick", "clock-show"] as const;
type Pool = Parameters<PerformanceMessages["pool"]>[0];
const poolId = (row: string, pool: Pool | null) => pool ? `multiwindow-performance-${row}-warm-${pool.warm}-hits-${pool.hits}-misses-${pool.misses}-released-${pool.released}${pool.memoryPressure ? "-pressure" : ""}` : `multiwindow-performance-${row}-none`;
const paintId = (row: string, paint: Paint) => `multiwindow-performance-${row}-${paint ? (paint.fast ? "fast" : "slow") : "none"}`;

export function Performance() {
  const t = usePerformanceMessages();
  const { pooled, tight, warmPaint, coldPaint, clock, hiddenRenders, runs, steps, done, error } = useWindowPerformance();
  const rows: [string, string, string][] = [
    [t.pooled, pooled ? t.pool(pooled) : t.none, poolId("pooled", pooled)],
    [t.tight, tight ? t.pool(tight) : t.none, poolId("tight", tight)],
    [t.warmPaint, warmPaint ? t.paint(warmPaint.ms) : t.none, paintId("warm-paint", warmPaint)],
    [t.coldPaint, coldPaint ? t.paint(coldPaint.ms) : t.none, paintId("cold-paint", coldPaint)],
    [t.clock, clock ? t.clockState(clock.value, clock.renders, clock.shown) : t.none, `multiwindow-performance-clock-${clock ? (clock.shown ? "shown" : "hidden") : "closed"}`],
    [t.hiddenRenders, hiddenRenders === null ? t.none : String(hiddenRenders), `multiwindow-performance-hidden-renders-${hiddenRenders ?? "none"}`],
  ];
  // Aligned to the leading edge, like the other screens' content.
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <View className="w-full max-w-3xl gap-1" testID="multiwindow-performance-availability">
      <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{t.availability}</Text>
      {FEATURES.map(feature => <Text key={feature} className="text-sm text-foreground" testID={`multiwindow-performance-availability-${feature}-${availability(feature)}`}>{t.features[feature]}: {availability(feature)}</Text>)}
    </View>
    <View className="w-full max-w-3xl gap-1 rounded-md border border-border p-3" testID="multiwindow-performance-readout">
      {rows.map(([label, value, testID]) => <View key={testID.split("-").slice(0, 3).join("-") + label} className="flex-row gap-3">
        <Text className="w-44 text-sm font-semibold text-foreground">{label}</Text>
        <Text className="flex-1 text-sm text-foreground" testID={testID}>{value}</Text>
      </View>)}
      <Text className="text-sm text-muted" testID={`multiwindow-performance-run-${runs}-steps-${steps}`}>{t.run(runs, steps)}</Text>
      {done !== null && <Text className="text-sm text-muted" testID={`multiwindow-performance-done-${done}`}>✓ {done}</Text>}
      {!!error && <Text className="text-sm text-danger" testID={`multiwindow-performance-error-${/^E_[A-Z_]+/.exec(error)?.[0] ?? "other"}`}>{error}</Text>}
    </View>
    <Text className="max-w-3xl text-sm text-muted" testID="multiwindow-performance-note">{t.note}</Text>
    <View className="w-full max-w-3xl flex-row flex-wrap gap-2">
      {BUTTONS.map(step => <ActionButton key={step} testID={`multiwindow-performance-${step}-button`} onPress={() => runStep(step)}>{t.buttons[step]}</ActionButton>)}
      <ActionButton testID="multiwindow-performance-close-all" onPress={closeAllWindows}>{t.buttons["close-all"]}</ActionButton>
    </View>
  </ScrollView>;
}
