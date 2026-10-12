import type { PropsWithChildren } from "react";
import { ScrollView, Switch, Text, TextInput as NativeTextInput, View } from "react-native";
import { TextInput } from "@legendapp/spark/ui";
import { getTextServicesAvailability } from "@legendapp/spark/ui/text-services";
import { Button } from "../../Controls";
import { BEHAVIORS, FEATURES, SAMPLE, useTextServicesDemo } from "./text-services-demo";
import { useTextServicesMessages } from "./text-services-messages";

// Test IDs: text-input-editing-text-services-{availability-<feature>,note,spark-input,look-up,writing-tools-<behavior>,
// find-query,find-case,find-wrap,find-next,find-previous,show-find-bar,result}.
const ID = "text-input-editing-text-services";
const input = "rounded-md border border-border bg-surface px-2 py-1 text-foreground";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-full max-w-3xl gap-2">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}
function Hint({ children }: PropsWithChildren) { return <Text className="text-xs text-muted">{children}</Text>; }
function Toggle({ testID, label, value, onValueChange }: { testID: string; label: string; value: boolean; onValueChange(value: boolean): void }) {
  return <View className="flex-row items-center gap-2">
    <Switch testID={testID} accessibilityLabel={label} value={value} onValueChange={onValueChange} />
    <Text className="text-sm text-foreground">{label}</Text>
  </View>;
}

export function TextServices() {
  const t = useTextServicesMessages();
  const { demo, state } = useTextServicesDemo();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="items-center gap-5 p-6">
    <Text className="max-w-3xl text-center text-sm text-muted">{t.intro}</Text>
    <Section title={t.sections.availability}>
      {FEATURES.map(feature => <Text key={feature} selectable className="font-mono text-xs text-muted" testID={`${ID}-availability-${feature}`}>{`${feature}: ${JSON.stringify(getTextServicesAvailability(feature))}`}</Text>)}
    </Section>
    <Section title={t.sections.services}>
      <Hint>{t.servicesHint}</Hint>
      <NativeTextInput ref={demo.noteRef} multiline testID={`${ID}-note`} accessibilityLabel={t.document} className={`h-28 ${input}`} defaultValue={SAMPLE} />
      <TextInput testID={`${ID}-spark-input`} accessibilityLabel={t.sparkInput} defaultValue="Services work in Spark text inputs too" style={{ width: "100%", height: 28 }} />
      <Button testID={`${ID}-look-up`} onPress={() => void demo.lookUp()}>{t.lookUp}</Button>
    </Section>
    <Section title={t.sections.writingTools}>
      <Hint>{t.writingToolsHint}</Hint>
      {BEHAVIORS.map(behavior => <View key={behavior} className="flex-row items-center gap-3">
        <Text className="w-40 text-sm text-foreground">{t.behaviors[behavior]}</Text>
        <NativeTextInput testID={`${ID}-writing-tools-${behavior}`} accessibilityLabel={t.behaviors[behavior]} writingToolsBehavior={behavior} className={`flex-1 ${input}`} defaultValue={`writingToolsBehavior="${behavior}"`} />
      </View>)}
    </Section>
    <Section title={t.sections.find}>
      <Hint>{t.findHint}</Hint>
      <NativeTextInput testID={`${ID}-find-query`} accessibilityLabel={t.query} placeholder={t.query} className={input} value={state.query} onChangeText={query => demo.set({ query })} />
      <View className="flex-row flex-wrap gap-4">
        <Toggle testID={`${ID}-find-case`} label={t.matchCase} value={state.caseSensitive} onValueChange={caseSensitive => demo.set({ caseSensitive })} />
        <Toggle testID={`${ID}-find-wrap`} label={t.wrap} value={state.wrap} onValueChange={wrap => demo.set({ wrap })} />
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Button testID={`${ID}-find-next`} onPress={() => void demo.find(false)}>{t.next}</Button>
        <Button testID={`${ID}-find-previous`} onPress={() => void demo.find(true)}>{t.previous}</Button>
        <Button testID={`${ID}-show-find-bar`} onPress={() => void demo.showFindBar()}>{t.showFindBar}</Button>
      </View>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-result`}>{t.result(state.result ?? "—")}</Text>
    </Section>
  </ScrollView>;
}
