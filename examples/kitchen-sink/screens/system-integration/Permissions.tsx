import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui/uniwind";
import { PERMISSION_KINDS, usePermissionsDemo } from "./permissions-demo";
import { usePermissionsMessages } from "./permissions-messages";

// Test IDs: system-integration-permissions-<kind>-status shows the state ("undetermined (notDetermined)"),
// -<kind>-request and -<kind>-settings run requestPermission and openPermissionSettings, and -<kind>-result shows
// what they returned; -event-<n> lists changes, newest first.
const ID = "system-integration-permissions";

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}`}>{children}</View>
  </View>;
}

/** Status, requests, System Settings links and change events for every privacy permission (@legendapp/spark/permissions). */
export function Permissions() {
  const t = usePermissionsMessages();
  const { availability, statuses, results, events, listening, error, run } = usePermissionsDemo();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.availability} id="availability-section">
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
    </Section>
    {error && <Text selectable className="text-sm text-danger" testID={`${ID}-error`}>{`${t.failed} ${error}`}</Text>}
    <Section title={t.permissions} id="list">
      {PERMISSION_KINDS.map(kind => <View key={kind} className="flex-row items-center gap-3">
        <Text className="w-44 text-sm text-foreground">{t.kinds[kind]}</Text>
        <View className="flex-1 gap-0.5">
          <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-${kind}-status`}>{statuses[kind] ?? t.reading}</Text>
          {results[kind] !== undefined && <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${kind}-result`}>{results[kind]}</Text>}
        </View>
        <Button className="w-24" testID={`${ID}-${kind}-request`} onPress={() => void run(kind, "request")}>{t.request}</Button>
        <Button className="w-24" testID={`${ID}-${kind}-settings`} onPress={() => void run(kind, "settings")}>{t.settings}</Button>
      </View>)}
    </Section>
    <Section title={t.events} id="events">
      <Text className="text-sm text-muted" testID={listening ? `${ID}-listening` : undefined}>{listening ? t.listening : t.subscribing}</Text>
      {events.length === 0 && <Text className="text-sm text-muted">{t.noEvents}</Text>}
      {events.map(({ key, text }, index) => <Text key={key} selectable className="font-mono text-xs text-foreground" testID={`${ID}-event-${index}`}>{text}</Text>)}
      <Text className="text-xs text-muted">{t.driver}</Text>
    </Section>
  </ScrollView>;
}
