import type { PropsWithChildren } from "react";
import { ScrollView, Text, TextInput, View, type ViewStyle } from "react-native";
import { PointerView as NativePointerView } from "@legendapp/spark/pointer";
import { withUniwind } from "uniwind";
import { Button } from "../../Controls";
import { CUSTOM_CURSOR, HAPTIC_PATTERNS, STYLE_CURSORS, pointerAvailability, usePointerDemo, type CanvasState } from "./pointer-demo";
import { usePointerMessages, type PointerMessages } from "./pointer-messages";

// Test IDs: pointer-trackpad-pointer-availability-<feature>, -cursor-<style value>, -cursor-custom, -cursor-custom-child,
// -typing, -hide (and -hide-result), -canvas, -<readout> (scale, rotation, swipe, smart-zooms, stage, force-clicks,
// button), -reset, -haptic-<pattern> (and -result), -haptic-invalid (and -result), -error.
const ID = "pointer-trackpad-pointer";
const PointerView = withUniwind(NativePointerView);
// React Native macOS maps every CSS cursor name; core React Native's types list only auto and pointer.

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-80 gap-3">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}
function Result({ id, value, none }: { id: string; value: string | undefined; none: string }) {
  return <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-${id}-result`}>{value ?? none}</Text>;
}
const READOUTS: [keyof PointerMessages["readouts"], string, (canvas: CanvasState) => string | null][] = [
  ["scale", "scale", canvas => canvas.scale.toFixed(2)],
  ["rotation", "rotation", canvas => String(Math.round(canvas.rotation))],
  ["swipe", "swipe", canvas => canvas.swipe],
  ["smartZooms", "smart-zooms", canvas => String(canvas.smartZooms)],
  ["stage", "stage", canvas => String(canvas.stage)],
  ["forceClicks", "force-clicks", canvas => String(canvas.forceClicks)],
  ["button", "button", canvas => canvas.button],
];

/** Cursors, hiding the cursor while typing, trackpad gestures, mouse buttons and haptics through @legendapp/spark/pointer. */
export function Pointer() {
  const t = usePointerMessages();
  const { canvas, results, error, handlers, reset, hide, haptic, invalidHaptic } = usePointerDemo();
  const availability = pointerAvailability();
  const available = availability.pointer.available;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-row flex-wrap gap-8 p-6">
    <Section title={t.sections.availability}>
      <View className="gap-1">
        {Object.entries(availability).map(([name, value]) => <Text key={name} selectable className="font-mono text-xs text-muted" testID={`${ID}-availability-${name}`}>{`${name}: ${JSON.stringify(value)}`}</Text>)}
      </View>
    </Section>
    <Section title={t.sections.cursors}>
      <Text className="text-xs text-muted">{t.cursorsHint}</Text>
      <View className="flex-row flex-wrap gap-2">
        {STYLE_CURSORS.map(cursor => <View key={cursor} testID={`${ID}-cursor-${cursor}`} style={{ cursor: cursor as ViewStyle["cursor"] }} className="h-12 w-24 items-center justify-center rounded-md border border-border bg-surface">
          <Text className="font-mono text-xs text-foreground">{cursor}</Text>
        </View>)}
      </View>
      {available
        ? <PointerView testID={`${ID}-cursor-custom`} customCursor={CUSTOM_CURSOR} onError={handlers.onError} className="gap-2 rounded-md border border-border bg-surface p-3">
          <Text className="text-xs text-foreground">{t.custom}</Text>
          <View testID={`${ID}-cursor-custom-child`} style={{ cursor: "pointer" }} className="items-center rounded-md bg-highlight px-2 py-2">
            <Text className="text-xs text-foreground">{t.customChild}</Text>
          </View>
        </PointerView>
        : <Text className="text-xs text-muted">{t.unavailable}</Text>}
    </Section>
    <Section title={t.sections.typing}>
      <Text className="text-xs text-muted">{t.typingHint}</Text>
      <TextInput testID={`${ID}-typing`} placeholder={t.placeholder} className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground" />
      <View className="gap-1">
        <Button testID={`${ID}-hide`} onPress={() => void hide()}>{t.hide}</Button>
        <Result id="hide" value={results.hide} none={t.none} />
      </View>
    </Section>
    <Section title={t.sections.canvas}>
      <Text className="text-xs text-muted">{t.canvasHint}</Text>
      {available
        ? <PointerView testID={`${ID}-canvas`} {...handlers} className="h-48 items-center justify-center overflow-hidden rounded-md border border-border bg-surface">
          <View className="h-16 w-24 items-center justify-center rounded-lg bg-accent-primary" style={{ transform: [{ scale: canvas.scale }, { rotate: `${canvas.rotation}deg` }] }}>
            <Text className="text-xs font-semibold text-surface">Spark</Text>
          </View>
        </PointerView>
        : <Text className="text-xs text-muted">{t.unavailable}</Text>}
      <View className="gap-1">
        {READOUTS.map(([label, id, read]) => <View key={id} className="flex-row justify-between">
          <Text className="text-xs text-foreground">{t.readouts[label]}</Text>
          <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${id}`}>{read(canvas) ?? t.none}</Text>
        </View>)}
      </View>
      <Button testID={`${ID}-reset`} onPress={reset}>{t.reset}</Button>
      {error ? <Text selectable className="text-xs text-danger" testID={`${ID}-error`}>{error}</Text> : null}
    </Section>
    <Section title={t.sections.haptics}>
      <Text className="text-xs text-muted">{t.hapticsHint}</Text>
      {HAPTIC_PATTERNS.map(pattern => <View key={pattern} className="gap-1">
        <Button testID={`${ID}-haptic-${pattern}`} onPress={() => void haptic(pattern)}>{t.patterns[pattern]}</Button>
        <Result id={`haptic-${pattern}`} value={results[`haptic-${pattern}`]} none={t.none} />
      </View>)}
      <View className="gap-1">
        <Button testID={`${ID}-haptic-invalid`} onPress={() => void invalidHaptic()}>{t.invalidPattern}</Button>
        <Result id="haptic-invalid" value={results["haptic-invalid"]} none={t.none} />
      </View>
    </Section>
  </ScrollView>;
}
