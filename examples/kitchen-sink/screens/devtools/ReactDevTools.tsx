import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "../../Controls";
import { useReactDevToolsDemo, useSampleCount } from "./react-devtools-demo";
import { useReactDevToolsMessages } from "./react-devtools-messages";

// Test IDs: devtools-react-devtools-{availability,shortcut,unavailable,sample,label,count,increment,open,open-note,open-isolated,result}.
const ID = "devtools-react-devtools";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-full max-w-3xl gap-2">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

/** The component the Components panel reads and edits (scripts/test-react-devtools.ts finds it by name). */
// Its state hook comes first: React DevTools numbers a useSyncExternalStore (useI18n) as one hook, React as two, so
// editing a later hook's state would change the wrong one (docs/devtools.md#react-devtools).
function ReactDevToolsSample({ label }: { label: string }) {
  const { count, increment } = useSampleCount();
  const t = useReactDevToolsMessages();
  return <View className="flex-row flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3" testID={`${ID}-sample`}>
    <Text className="min-w-40 flex-1 text-sm font-semibold text-foreground" testID={`${ID}-label`}>{label}</Text>
    <Text className="font-mono text-sm text-foreground" testID={`${ID}-count`}>{t.count(count)}</Text>
    <Button testID={`${ID}-increment`} onPress={increment}>{t.increment}</Button>
  </View>;
}

export function ReactDevTools() {
  const t = useReactDevToolsMessages();
  const { availability, result, open, openNote, openIsolated } = useReactDevToolsDemo(t.opened);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="max-w-3xl text-sm text-muted">{t.intro}</Text>
    <Section title={t.sections.availability}>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      <Text className="text-sm text-foreground" testID={availability.available ? `${ID}-shortcut` : `${ID}-unavailable`}>{availability.available ? t.shortcut : t.unavailable}</Text>
    </Section>
    {availability.available ? <>
      <Section title={t.sections.sample}>
        <ReactDevToolsSample label={t.sampleLabel} />
      </Section>
      <Section title={t.sections.windows}>
        <Text className="text-sm text-muted">{t.windows}</Text>
        <View className="flex-row flex-wrap gap-2">
          <Button testID={`${ID}-open-note`} onPress={() => void openNote()}>{t.openNote}</Button>
          <Button testID={`${ID}-open-isolated`} onPress={() => void openIsolated()}>{t.openIsolated}</Button>
        </View>
      </Section>
      <Section title={t.sections.panels}>
        <Text className="text-sm text-muted">{t.panels}</Text>
        <Button testID={`${ID}-open`} onPress={() => void open()}>{t.open}</Button>
      </Section>
      <Section title={t.sections.result}>
        <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-result`}>{result ?? t.noResult}</Text>
      </Section>
    </> : null}
  </ScrollView>;
}
