import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "../../Controls";
import { dialogAvailability, useDialogDemos, type DemoId } from "./dialog-demos";
import { useDialogMessages } from "./dialog-messages";

// Test IDs: dialogs-panels-<demo> triggers a dialog, dialogs-panels-<demo>-result shows its JSON result.
const ID = "dialogs-panels";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-80 gap-3">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

export function Panels() {
  const t = useDialogMessages();
  const { results, suppressed, run, askAgain } = useDialogDemos(t);
  const demo = (id: DemoId, label: string) => <View key={id} className="gap-1">
    <Button testID={`${ID}-${id}`} onPress={() => void run(id)}>{label}</Button>
    <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-${id}-result`}>{results[id] ?? t.noResult}</Text>
  </View>;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-row flex-wrap gap-8 p-6">
    <Section title={t.sections.availability}>
      <View className="gap-1">
        {Object.entries(dialogAvailability()).map(([name, value]) => <Text key={name} selectable className="font-mono text-xs text-muted" testID={`${ID}-availability-${name}`}>{`${name}: ${JSON.stringify(value)}`}</Text>)}
      </View>
    </Section>
    <Section title={t.sections.files}>{demo("open", t.open)}{demo("save", t.save)}</Section>
    <Section title={t.sections.messages}>
      {demo("trash", t.emptyTrash)}
      <View className="flex-row flex-wrap items-center gap-3">
        <Text className="text-sm text-foreground" testID={`${ID}-suppressed`}>{t.suppressed(suppressed)}</Text>
        <Button testID={`${ID}-ask-again`} disabled={!suppressed} onPress={askAgain}>{t.askAgain}</Button>
      </View>
      {demo("confirm", t.confirm)}
    </Section>
    <Section title={t.sections.prompts}>{demo("rename", t.rename)}{demo("unlock", t.unlock)}</Section>
    <Section title={t.sections.about}>{demo("about", t.aboutStandard)}{demo("about-overrides", t.aboutOverrides)}</Section>
  </ScrollView>;
}
