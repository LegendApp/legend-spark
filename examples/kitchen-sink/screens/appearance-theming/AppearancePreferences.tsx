import type { ReactNode } from "react";
import { Platform, PlatformColor, ScrollView, Text, View } from "react-native";
import type { AppearancePreferences as Preferences } from "@legendapp/spark/system";
import { Button } from "../../Controls";
import { useAppearanceMessages } from "./appearance-messages";
import { useAppearancePreferences, type WindowAppearance } from "./useAppearancePreferences";

// Test IDs under appearance-theming-preferences: -availability, -error, -listening, -no-events, -event-<n> (newest
// first), -<field> (the reported value), -window-<system|light|dark> (buttons), -window-applied and -color-<name>.
const ID = "appearance-theming-preferences";
/** Kitchen Sink screens render in the host-created main window. */
const MAIN_WINDOW = "main";
const FIELDS = ["appearance", "automaticAppearance", "accentColor", "highlightColor", "increaseContrast", "reduceTransparency", "reduceMotion",
  "differentiateWithoutColor", "invertColors", "keyboardNavigation"] as const satisfies readonly (keyof Preferences)[];
const WINDOW_APPEARANCES: readonly WindowAppearance[] = ["system", "light", "dark"];
/** AppKit semantic colors, by their NSColor names. */
const SEMANTIC_COLORS = ["controlAccentColor", "selectedTextBackgroundColor", "labelColor", "secondaryLabelColor", "windowBackgroundColor",
  "controlBackgroundColor", "separatorColor", "systemRedColor", "systemGreenColor", "systemBlueColor"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3">{children}</View>
  </View>;
}
function PreferenceField({ label, field, value }: { label: string; field: keyof Preferences; value: Preferences[keyof Preferences] }) {
  const color = field === "accentColor" || field === "highlightColor" ? String(value) : undefined;
  return <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
    <Text className="w-52 text-sm text-muted">{label}</Text>
    {color ? <View className="h-4 w-4 rounded border border-border" style={{ backgroundColor: color }} /> : null}
    <Text selectable className="font-mono text-sm text-foreground" testID={`${ID}-${field}`}>{String(value)}</Text>
  </View>;
}

/** Appearance and accessibility preferences, their change events, a per-window appearance override and semantic colors. */
export function AppearancePreferences() {
  const t = useAppearanceMessages();
  const { availability, preferences, events, listening, error, windowAppearance, overrideWindow } = useAppearancePreferences(MAIN_WINDOW);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="max-w-2xl text-sm text-muted">{t.intro}</Text>
    <Section title={t.sections.availability}>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      {error ? <Text selectable className="font-mono text-xs text-danger" testID={`${ID}-error`}>{error}</Text> : null}
    </Section>
    <Section title={t.sections.preferences}>
      {preferences ? FIELDS.map(field => <PreferenceField key={field} label={t.fields[field]} field={field} value={preferences[field]} />)
        : <Text className="text-sm text-muted">{error ? "—" : t.loading}</Text>}
    </Section>
    <Section title={t.sections.events}>
      <Text className="text-sm text-muted" testID={listening ? `${ID}-listening` : undefined}>{listening ? t.listening : t.subscribing}</Text>
      {events.length === 0 && <Text className="max-w-2xl text-sm text-muted" testID={`${ID}-no-events`}>{t.noEvents}</Text>}
      {events.map(({ key, type }, index) => <Text key={key} selectable className="font-mono text-sm text-foreground" testID={`${ID}-event-${index}`}>{type}</Text>)}
      <Text className="max-w-2xl text-xs text-muted">{t.injected}</Text>
    </Section>
    <Section title={t.sections.window}>
      <Text className="max-w-2xl text-sm text-muted">{t.windowIntro}</Text>
      <View className="flex-row flex-wrap gap-2">
        {WINDOW_APPEARANCES.map(value => <Button key={value} testID={`${ID}-window-${value}`} onPress={() => overrideWindow(value)}>{t.windowOptions[value]}</Button>)}
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="text-sm text-muted">{t.windowApplied}</Text>
        <Text selectable className="font-mono text-sm text-foreground" testID={`${ID}-window-applied`}>{windowAppearance}</Text>
      </View>
    </Section>
    <Section title={t.sections.colors}>
      {Platform.OS === "macos" ? <>
        <Text className="max-w-2xl text-sm text-muted">{t.colorsIntro}</Text>
        <View className="flex-row flex-wrap gap-3">
          {SEMANTIC_COLORS.map(name => <View key={name} className="w-56 flex-row items-center gap-2" testID={`${ID}-color-${name}`}>
            <View className="h-6 w-6 rounded border border-border" style={{ backgroundColor: PlatformColor(name) }} />
            <Text className="shrink font-mono text-xs" style={{ color: PlatformColor("labelColor") }}>{name}</Text>
          </View>)}
        </View>
      </> : <Text className="text-sm text-muted">{t.colorsUnsupported}</Text>}
    </Section>
  </ScrollView>;
}
