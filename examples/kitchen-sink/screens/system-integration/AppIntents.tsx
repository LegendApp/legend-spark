import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui/uniwind";
import { NOTE_ENTITY, NOTE_INTENT, RECIPE_INTENT, TIMER_INTENT } from "./app-intents-config";
import { useAppIntentsDemo } from "./app-intents-demo";
import { useAppIntentsMessages } from "./app-intents-messages";

// Test IDs: system-integration-app-intents-availability and -declared; -status-<intent or entity id> for each handler and -listen
// to register them again; -donate with -donation; -event-<n> lists invocations, newest first.
const ID = "system-integration-app-intents";

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}`}>{children}</View>
  </View>;
}

/** App Intents handlers, an entity query handler, a donation and the declared intents (@legendapp/spark/app-intents). */
export function AppIntents() {
  const t = useAppIntentsMessages();
  const { availability, declared, statuses, events, donation, error, listen, donate } = useAppIntentsDemo();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.availability} id="availability-section">
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      <Text className="text-sm text-muted">{t.declared}</Text>
      <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-declared`}>{declared ?? t.registering}</Text>
    </Section>
    {error && <Text selectable className="text-sm text-danger" testID={`${ID}-error`}>{`${t.failed} ${error}`}</Text>}
    <Section title={t.handlers} id="handlers">
      <Text className="text-sm text-muted">{t.handlersHint}</Text>
      {[RECIPE_INTENT, TIMER_INTENT, NOTE_INTENT, NOTE_ENTITY].map(intent => <View key={intent} className="flex-row items-center gap-3">
        <Text selectable className="w-32 font-mono text-xs text-muted">{intent}</Text>
        <Text selectable className="flex-1 font-mono text-xs text-foreground" testID={`${ID}-status-${intent}`}>{statuses[intent] ?? t.registering}</Text>
      </View>)}
      <View className="flex-row"><Button testID={`${ID}-listen`} onPress={listen}>{t.listen}</Button></View>
    </Section>
    <Section title={t.donation} id="donation-section">
      <Text className="text-sm text-muted">{t.donationHint}</Text>
      <View className="flex-row items-center gap-3">
        <Button testID={`${ID}-donate`} onPress={() => void donate()}>{t.donate}</Button>
        {donation !== undefined && <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-donation`}>{donation}</Text>}
      </View>
    </Section>
    <Section title={t.events} id="events">
      {events.length === 0 && <Text className="text-sm text-muted">{t.noEvents}</Text>}
      {events.map(({ key, text }, position) => <Text key={key} selectable className="font-mono text-xs text-foreground" testID={`${ID}-event-${position}`}>{text}</Text>)}
      <Text className="text-xs text-muted">{t.driver}</Text>
    </Section>
  </ScrollView>;
}
