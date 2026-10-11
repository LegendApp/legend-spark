import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { SHOWN_FIELDS, shownValue, useDisplaysDemo } from "./displays-demo";
import { useDisplaysMessages } from "./displays-messages";

// Test IDs under displays-graphics-displays: -availability, -error, -display-<id> (a card), -display-<id>-primary,
// -display-<id>-<field> (JSON with a fixed key order) and -change-<n>-added|removed|changed (JSON), n counting from 1.
const ID = "displays-graphics-displays";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="gap-3">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}
function Row({ label, value, testID }: { label: string; value: string; testID: string }) {
  return <View className="gap-0.5">
    <Text className="text-xs text-muted">{label}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={testID}>{value}</Text>
  </View>;
}

/** Every display's details from @legendapp/spark/displays, and the changes reported while the screen is open. */
export function Displays() {
  const t = useDisplaysMessages();
  const { availability, displays, changes, error } = useDisplaysDemo();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-8 p-6">
    <Section title={t.sections.availability}>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      {error ? <Text selectable className="font-mono text-xs text-danger" testID={`${ID}-error`}>{error}</Text> : null}
    </Section>
    <Section title={t.sections.displays}>
      {displays ? <View className="flex-row flex-wrap gap-4">
        {displays.map(display => <View key={display.id} testID={`${ID}-display-${display.id}`} className="w-80 gap-2 rounded-lg border border-border bg-surface p-4">
          <View className="flex-row items-center gap-2">
            <Text className="shrink text-base font-semibold text-foreground" testID={`${ID}-display-${display.id}-name`}>{display.name}</Text>
            {display.primary ? <Text className="rounded bg-highlight px-1.5 text-xs text-foreground" testID={`${ID}-display-${display.id}-primary`}>{t.primary}</Text> : null}
          </View>
          <Text selectable className="font-mono text-xs text-muted">{`id ${display.id}`}</Text>
          {SHOWN_FIELDS.map(field => <Row key={field} label={t.fields[field]} value={shownValue(display, field)} testID={`${ID}-display-${display.id}-${field}`} />)}
        </View>)}
      </View> : error ? null : <Text className="text-sm text-muted">{t.loading}</Text>}
    </Section>
    <Section title={t.sections.changes}>
      {changes.length ? changes.map(({ number, event }) => <View key={number} className="w-full max-w-2xl gap-1 rounded-lg border border-border p-3" testID={`${ID}-change-${number}`}>
        <Text className="text-sm font-semibold text-foreground">{t.change(number)}</Text>
        <Row label={t.added} value={JSON.stringify(event.added)} testID={`${ID}-change-${number}-added`} />
        <Row label={t.removed} value={JSON.stringify(event.removed)} testID={`${ID}-change-${number}-removed`} />
        <Row label={t.changed} value={JSON.stringify(event.changed)} testID={`${ID}-change-${number}-changed`} />
      </View>) : <Text className="max-w-2xl text-sm text-muted">{t.noChanges}</Text>}
    </Section>
  </ScrollView>;
}
