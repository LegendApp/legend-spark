import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { WebView } from "@legendapp/spark/webview";
import { Button } from "../../Controls";
import { useI18n } from "../../shell/app-controller";
import { inspectedPage, useWebInspectorDemo } from "./web-inspector-demo";
import { useWebInspectorMessages } from "./web-inspector-messages";

// Test IDs: devtools-web-inspector-{availability,unavailable,bundle,default,toggle,opt-in}.
const ID = "devtools-web-inspector";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-full max-w-3xl gap-2">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

export function WebInspector() {
  const t = useWebInspectorMessages();
  const { rtl } = useI18n();
  const { availability, development, optIn, toggleOptIn } = useWebInspectorDemo();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="max-w-3xl text-sm text-muted">{t.intro}</Text>
    <Section title={t.sections.availability}>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      {availability.available ? null : <Text className="text-sm text-foreground" testID={`${ID}-unavailable`}>{t.unavailable}</Text>}
    </Section>
    {availability.available ? <>
      <Section title={t.sections.default}>
        <Text className="text-sm text-foreground" testID={`${ID}-bundle`}>{development ? t.development : t.release}</Text>
        <View className="h-16 w-full overflow-hidden rounded-lg border border-border"><WebView testID={`${ID}-default`} style={{ flex: 1 }} source={inspectedPage(t.defaultPage, rtl)} /></View>
      </Section>
      <Section title={t.sections.optIn}>
        <Text className="text-sm text-muted">{t.optIn}</Text>
        <Button testID={`${ID}-toggle`} onPress={toggleOptIn}>{optIn ? t.unmount : t.mount}</Button>
        {optIn ? <View className="h-16 w-full overflow-hidden rounded-lg border border-border"><WebView testID={`${ID}-opt-in`} inspectable style={{ flex: 1 }} source={inspectedPage(t.optInPage, rtl)} /></View> : null}
      </Section>
      <Section title={t.sections.attach}>
        <Text className="text-sm text-muted">{t.attach}</Text>
      </Section>
    </> : null}
  </ScrollView>;
}
