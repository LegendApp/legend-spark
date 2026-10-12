import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "../../Controls";
import { PROMISED_TYPES, clipboardAvailability, useClipboardDemo } from "./clipboard-demo";
import { useClipboardMessages } from "./clipboard-messages";

// Test IDs: clipboard-data-availability-<feature>; buttons clipboard-data-<action> with clipboard-data-<action>-result
// (copy-text, copy-rich, copy-concealed, copy-transient, promise, promise-slow, promise-failing, read, get-html, formats, has-text,
// clear, change-count; watch and unwatch share watch-result); clipboard-data-provided, -provide-error, -watching,
// -events, -last-change.
const ID = "clipboard-data";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-80 gap-3">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}
function Readout({ id, value }: { id: string; value: string }) {
  return <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-${id}`}>{value}</Text>;
}
function Row({ label, id, value }: { label: string; id: string; value: string }) {
  return <View className="flex-row justify-between gap-2">
    <Text className="text-xs text-foreground">{label}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${id}`}>{value}</Text>
  </View>;
}

/** Promised data, change monitoring, privacy markers and rich reads and writes through @legendapp/spark/clipboard. */
export function ClipboardData() {
  const t = useClipboardMessages();
  const demo = useClipboardDemo();
  const availability = clipboardAvailability();
  const action = (id: string, label: string, onPress: () => Promise<void>, enabled = true) => <View key={id} className="gap-1">
    <Button testID={`${ID}-${id}`} disabled={!enabled} onPress={() => void onPress()}>{label}</Button>
    <Readout id={`${id}-result`} value={demo.results[id] ?? t.none} />
  </View>;
  const promisedData = availability["promised-data"].available, changeEvents = availability["change-events"].available, privacyMarkers = availability["privacy-markers"].available;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-row flex-wrap gap-8 p-6">
    <Section title={t.sections.availability}>
      <View className="gap-1">
        {Object.entries(availability).map(([name, value]) => <Readout key={name} id={`availability-${name}`} value={`${name}: ${JSON.stringify(value)}`} />)}
      </View>
    </Section>
    <Section title={t.sections.write}>
      <Text className="text-xs text-muted">{t.writeHint}</Text>
      {action("copy-text", t.copyText, demo.copyText)}
      {action("copy-rich", t.copyRich, demo.copyRich)}
      {action("copy-concealed", t.copyConcealed, demo.copyConcealed)}
      {action("copy-transient", t.copyTransient, demo.copyTransient)}
      {privacyMarkers ? null : <Text className="text-xs text-muted">{t.unavailable}</Text>}
    </Section>
    <Section title={t.sections.promised}>
      <Text className="text-xs text-muted">{t.promisedHint}</Text>
      {action("promise", t.promise, demo.promise)}
      {action("promise-slow", t.promiseSlow, demo.promiseSlow)}
      {action("promise-failing", t.promiseFailing, demo.promiseFailing)}
      <Row label={t.provided} id="provided" value={PROMISED_TYPES.map(type => `${type} ${demo.provided[type]}`).join(" · ")} />
      <Row label={t.provideError} id="provide-error" value={demo.provideError ?? t.none} />
      {promisedData ? null : <Text className="text-xs text-muted">{t.unavailable}</Text>}
    </Section>
    <Section title={t.sections.read}>
      <Text className="text-xs text-muted">{t.readHint}</Text>
      {action("read", t.read, demo.read)}
      {action("get-html", t.getHtml, demo.getHtml)}
      {action("formats", t.formats, demo.formats)}
      {action("has-text", t.hasText, demo.hasText)}
      {action("clear", t.clear, demo.clear)}
    </Section>
    <Section title={t.sections.changes}>
      <Text className="text-xs text-muted">{t.changesHint}</Text>
      <View className="gap-1">
        <Button testID={`${ID}-watch`} disabled={demo.changes.watching} onPress={() => void demo.watch()}>{t.watch}</Button>
        <Button testID={`${ID}-unwatch`} disabled={!demo.changes.watching} onPress={() => void demo.unwatch()}>{t.unwatch}</Button>
        <Readout id="watch-result" value={demo.results.watch ?? t.none} />
      </View>
      <Row label={t.watching} id="watching" value={String(demo.changes.watching)} />
      <Row label={t.events} id="events" value={String(demo.changes.events)} />
      <Row label={t.lastChange} id="last-change" value={demo.changes.changeCount === null ? t.none : String(demo.changes.changeCount)} />
      {action("change-count", t.changeCount, demo.changeCount)}
      {changeEvents ? null : <Text className="text-xs text-muted">{t.unavailable}</Text>}
    </Section>
  </ScrollView>;
}
