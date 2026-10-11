import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import type { SystemEvent } from "@legendapp/spark/system";
import { Button } from "../../Controls";
import { useSystemStateMessages } from "./system-state-messages";
import { SYSTEM_FEATURES, useSystemState } from "./useSystemState";

// Test IDs: system-integration-state-<field>. Values are what @legendapp/spark/system reports.
const ID = "system-integration-state";

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-x-3 gap-y-1">
    <Text className="w-44 text-sm text-muted">{label}</Text>
    <Text selectable className="flex-1 text-sm text-foreground" testID={`${ID}-${id}`}>{children}</Text>
  </View>;
}
function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}`}>{children}</View>
  </View>;
}
const describe = (event: SystemEvent) => event.type === "memoryPressure" ? `${event.type}: ${event.level}` : event.type;

/** System information, network path and proxies, and live system events, with per-platform availability. */
export function SystemState() {
  const t = useSystemStateMessages();
  const { availability, info, network, events, listening, error, refresh } = useSystemState();
  const yesNo = (value: boolean) => value ? t.yes : t.no;
  const proxies = network && Object.entries(network.proxies).filter(([, value]) => value !== null).map(([kind, value]) => `${kind}: ${value}`);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.events} id="events">
      <Text className="text-sm text-muted" testID={listening ? `${ID}-listening` : undefined}>{listening ? t.listening : t.subscribing}</Text>
      {events.length === 0 && <Text className="text-sm text-muted" testID={`${ID}-no-events`}>{t.noEvents}</Text>}
      {events.map(({ key, event }, index) => <Text key={key} selectable className="text-sm text-foreground" testID={`${ID}-event-${index}`}>{describe(event)}</Text>)}
      <Text className="text-xs text-muted">{t.injected}</Text>
    </Section>
    <Section title={t.availability} id="availability">
      {SYSTEM_FEATURES.map(feature => <Field key={feature} label={feature} id={`availability-${feature}`}>{JSON.stringify(availability[feature])}</Field>)}
    </Section>
    {error && <Text selectable className="text-sm text-danger" testID={`${ID}-error`}>{`${t.failed} ${error}`}</Text>}
    <Button testID={`${ID}-refresh`} onPress={refresh}>{t.refresh}</Button>
    <Section title={t.information} id="info">
      {info ? <>
        <Field label={t.osVersion} id="os-version">{info.osVersion}</Field>
        <Field label={t.architecture} id="architecture">{info.architecture}</Field>
        <Field label={t.translated} id="translated">{yesNo(info.translated)}</Field>
        <Field label={t.locale} id="locale">{info.locale}</Field>
        <Field label={t.timeZone} id="time-zone">{info.timeZone}</Field>
        <Field label={t.appearance} id="appearance">{info.dark ? t.dark : t.light}</Field>
        <Field label={t.idle} id="idle">{t.seconds(info.idleSeconds)}</Field>
        <Field label={t.powerSource} id="power-source">{info.onBattery ? t.onBattery : t.onAC}</Field>
        <Field label={t.battery} id="battery">{info.batteryLevel === null ? t.noBattery : `${Math.round(info.batteryLevel * 100)}%`}</Field>
        <Field label={t.lowPower} id="low-power">{yesNo(info.lowPowerMode)}</Field>
        <Field label={t.thermal} id="thermal">{info.thermalState ?? t.unsupported}</Field>
      </> : <Text className="text-sm text-muted">{t.loading}</Text>}
    </Section>
    <Section title={t.network} id="network">
      {!availability.networkStatus.available ? <Text className="text-sm text-muted">{t.unsupported}</Text> : network ? <>
        <Field label={t.status} id="network-status">{network.status}</Field>
        <Field label={t.interfaces} id="network-interfaces">{network.interfaces.join(", ") || t.none}</Field>
        <Field label={t.expensive} id="network-expensive">{yesNo(network.expensive)}</Field>
        <Field label={t.constrained} id="network-constrained">{yesNo(network.constrained)}</Field>
        <Field label={t.proxies} id="network-proxies">{proxies?.length ? proxies.join("\n") : t.none}</Field>
      </> : <Text className="text-sm text-muted">{t.loading}</Text>}
    </Section>
  </ScrollView>;
}
