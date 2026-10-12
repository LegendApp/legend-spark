import { useRef, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui/uniwind";
import { SERVICE, SHARE_KINDS, useSharingDemo } from "./sharing-demo";
import { useSharingMessages } from "./sharing-messages";

// Test IDs: system-integration-sharing-share-<text|link|file> share and -share-result shows the chosen service,
// "dismissed" or the error code; -service-status and -listen for the Services listener; -spotlight-index and
// -spotlight-delete with -spotlight-result; -default-status, -make-default and -default-result for the spark-ks handler;
// -event-<n> lists service invocations, Spotlight openings and universal links, newest first.
const ID = "system-integration-sharing";

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}`}>{children}</View>
  </View>;
}
function Result({ id, children }: { id: string; children?: string }) {
  return children === undefined ? null : <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${id}`}>{children}</Text>;
}

/** Share picker, Services listener, Spotlight items and the default URL handler (@legendapp/spark/sharing and /links). */
export function Sharing() {
  const t = useSharingMessages();
  const anchor = useRef<View>(null);
  const { availability, results, serviceStatus, events, defaultHandler, error, shareKind, listen, index, remove, makeDefault } = useSharingDemo(anchor);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.availability} id="availability-section">
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
    </Section>
    {error && <Text selectable className="text-sm text-danger" testID={`${ID}-error`}>{`${t.failed} ${error}`}</Text>}
    <Section title={t.share} id="share">
      <View ref={anchor} collapsable={false} className="flex-row flex-wrap gap-2 self-start" testID={`${ID}-share-anchor`}>
        {SHARE_KINDS.map(kind => <Button key={kind} testID={`${ID}-share-${kind}`} onPress={() => void shareKind(kind)}>{t.shareKinds[kind]}</Button>)}
      </View>
      <Result id="share-result">{results.share}</Result>
    </Section>
    <Section title={t.services} id="services">
      <Text className="text-sm text-muted">{t.serviceHint(SERVICE)}</Text>
      <View className="flex-row items-center gap-3">
        <Text selectable className="flex-1 font-mono text-xs text-foreground" testID={`${ID}-service-status`}>{serviceStatus ?? t.registering}</Text>
        <Button testID={`${ID}-listen`} onPress={listen}>{t.listen}</Button>
      </View>
    </Section>
    <Section title={t.spotlight} id="spotlight">
      <Text className="text-sm text-muted">{t.spotlightHint}</Text>
      <View className="flex-row flex-wrap gap-2">
        <Button testID={`${ID}-spotlight-index`} onPress={() => void index()}>{t.index}</Button>
        <Button testID={`${ID}-spotlight-delete`} onPress={() => void remove()}>{t.remove}</Button>
      </View>
      <Result id="spotlight-result">{results.spotlight}</Result>
    </Section>
    <Section title={t.defaultHandler} id="default">
      <View className="flex-row items-center gap-3">
        <Text selectable className="flex-1 font-mono text-xs text-foreground" testID={`${ID}-default-status`}>{defaultHandler ?? t.reading}</Text>
        <Button testID={`${ID}-make-default`} onPress={() => void makeDefault()}>{t.makeDefault}</Button>
      </View>
      <Result id="default-result">{results.default}</Result>
    </Section>
    <Section title={t.events} id="events">
      {events.length === 0 && <Text className="text-sm text-muted">{t.noEvents}</Text>}
      {events.map(({ key, text }, position) => <Text key={key} selectable className="font-mono text-xs text-foreground" testID={`${ID}-event-${position}`}>{text}</Text>)}
      <Text className="text-xs text-muted">{t.driver}</Text>
    </Section>
  </ScrollView>;
}
