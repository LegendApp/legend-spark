import { useEffect, useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ActionButton } from "../../ActionButton";
import { FEATURES, ITEMS, WINDOWS, availability, closeAllWindows, refreshNow, registerSource, runStep, selectItem, useWindowChoreography, type WindowState } from "./window-choreography";
import { useChoreographyMessages } from "./choreography-messages";

const BUTTONS = ["zoom", "zoom-thumb", "close", "stop", "compact", "full", "pane-general", "pane-advanced", "tear-off", "merge", "inspector", "palette", "palette-nudge", "palette-away", "palette-back"] as const;
const stateId = (state: WindowState) => state ? `${state.visible ? "shown" : "hidden"}-${state.displayId}-${state.x}-${state.y}-${state.width}x${state.height}` : "closed";
/** A view the screen's zooms start from: registered while mounted. */
function useSource(name: string) {
  const ref = useRef<View>(null);
  useEffect(() => registerSource(name, ref), [name]);
  return ref;
}

function Row({ item, label, selected }: { item: typeof ITEMS[number]; label: string; selected: boolean }) {
  const ref = useSource(`row-${item}`);
  return <Pressable ref={ref} onPress={() => selectItem(item)} accessibilityRole="button" accessibilityState={{ selected }} testID={`multiwindow-choreography-row-${item}${selected ? "-selected" : ""}`}
    className={`rounded-md px-3 py-2 ${selected ? "bg-accent-primary" : ""}`}>
    <Text className={selected ? "text-background" : "text-foreground"}>{label}</Text>
  </Pressable>;
}

export function Choreography() {
  const t = useChoreographyMessages();
  const { windows, selected, tornOff, attached, animation, close, reduceMotion, runs, steps, error } = useWindowChoreography();
  const panel = useSource("panel");
  const rows: [string, string, string][] = [
    ...WINDOWS.map((window): [string, string, string] => [t.windows[window], t.window(windows[window]), `multiwindow-choreography-${window}-${stateId(windows[window])}`]),
    [`${t.windows.inspector} ↔`, t.attached(attached.inspector), `multiwindow-choreography-inspector-attached-${attached.inspector ?? "none"}`],
    [`${t.windows.palette} ↔`, t.attached(attached.palette), `multiwindow-choreography-palette-attached-${attached.palette ?? "none"}`],
    [t.animationLabel, t.animation[animation], `multiwindow-choreography-animation-${animation}`],
    [t.closeLabel, t.close[close], `multiwindow-choreography-close-${close}`],
    [t.reduceMotionLabel, t.reduceMotion(reduceMotion), `multiwindow-choreography-reduce-motion-${reduceMotion ?? "unknown"}`],
  ];
  // Aligned to the leading edge, like the other screens' content.
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <View className="w-full max-w-3xl gap-1" testID="multiwindow-choreography-availability">
      <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{t.availability}</Text>
      {FEATURES.map(feature => <Text key={feature} className="text-sm text-foreground" testID={`multiwindow-choreography-availability-${feature}-${availability(feature)}`}>{t.features[feature]}: {availability(feature)}</Text>)}
    </View>
    <View className="w-full max-w-3xl flex-row gap-4">
      <View className="w-48 gap-1 rounded-md border border-border p-2" testID="multiwindow-choreography-list">
        <Text className="px-3 text-sm font-semibold text-muted" accessibilityRole="header">{t.list}</Text>
        {ITEMS.map(item => <Row key={item} item={item} label={t.items[item]} selected={item === selected} />)}
      </View>
      <View ref={panel} className="flex-1 gap-1 rounded-md border border-border p-3" testID={`multiwindow-choreography-panel-${tornOff ? "torn-off" : "docked"}`}>
        <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{t.panel}</Text>
        <Text className="text-sm text-muted">{tornOff ? t.tornOff : t.panelText}</Text>
      </View>
    </View>
    <View className="w-full max-w-3xl gap-1 rounded-md border border-border p-3" testID="multiwindow-choreography-readout">
      {rows.map(([label, value, testID]) => <View key={label} className="flex-row gap-3">
        <Text className="w-44 text-sm font-semibold text-foreground">{label}</Text>
        <Text className="flex-1 text-sm text-foreground" testID={testID}>{value}</Text>
      </View>)}
      <Text className="text-sm text-muted" testID={`multiwindow-choreography-run-${runs}-steps-${steps}`}>{t.run(runs, steps)}</Text>
      {!!error && <Text className="text-sm text-danger" testID={`multiwindow-choreography-error-${/^E_[A-Z_]+/.exec(error)?.[0] ?? "other"}`}>{error}</Text>}
    </View>
    <Text className="max-w-3xl text-sm text-muted" testID="multiwindow-choreography-note">{t.note}</Text>
    <View className="w-full max-w-3xl flex-row flex-wrap gap-2">
      {BUTTONS.map(step => <ActionButton key={step} testID={`multiwindow-choreography-${step}-button`} onPress={() => runStep(step)}>{t.buttons[step]}</ActionButton>)}
      <ActionButton testID="multiwindow-choreography-refresh" onPress={refreshNow}>{t.buttons.refresh}</ActionButton>
      <ActionButton testID="multiwindow-choreography-close-all" onPress={closeAllWindows}>{t.buttons["close-all"]}</ActionButton>
    </View>
  </ScrollView>;
}
