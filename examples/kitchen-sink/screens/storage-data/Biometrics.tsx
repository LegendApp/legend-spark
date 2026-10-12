import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui/uniwind";
import { ACCESSES, FALLBACKS, useBiometricsDemo } from "./biometrics-demo";
import { useBiometricsMessages } from "./biometrics-messages";

// Test IDs: storage-data-biometrics-availability and -status; -auth-<fallback> prompts with that fallback, -auth-cancel
// aborts the pending prompt, -auth-result shows "<fallback>: <outcome or error>"; -secret-<access>-store, -read and
// -delete act on that access's secret, and -secret-<access>-result shows what they returned.
const ID = "storage-data-biometrics";

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}`}>{children}</View>
  </View>;
}

/** Touch ID status, prompts per fallback policy and biometry-gated Keychain secrets (@legendapp/spark/biometrics). */
export function Biometrics() {
  const t = useBiometricsMessages();
  const { availability, status, authResult, secretResults, prompting, refresh, authenticate, cancel, secret } = useBiometricsDemo();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.status} id="status-section">
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      <View className="flex-row items-center gap-3">
        <Text selectable className="flex-1 font-mono text-xs text-foreground" testID={`${ID}-status`}>{status ?? t.reading}</Text>
        <Button className="w-28" testID={`${ID}-status-refresh`} onPress={() => void refresh()}>{t.refresh}</Button>
      </View>
    </Section>
    <Section title={t.authenticate} id="auth">
      {FALLBACKS.map(fallback => <View key={fallback} className="flex-row items-center gap-3">
        <Text className="flex-1 text-sm text-foreground">{t.fallbacks[fallback]}</Text>
        <Button className="w-28" testID={`${ID}-auth-${fallback}`} onPress={() => void authenticate(fallback)}>{t.prompt}</Button>
      </View>)}
      <View className="flex-row items-center gap-3">
        <Text selectable className="flex-1 font-mono text-xs text-foreground" testID={`${ID}-auth-result`}>{authResult ?? (prompting ? t.prompting : t.noResult)}</Text>
        <Button className="w-28" testID={`${ID}-auth-cancel`} onPress={cancel}>{t.cancel}</Button>
      </View>
    </Section>
    <Section title={t.secrets} id="secrets">
      {ACCESSES.map(access => <View key={access} className="flex-row items-center gap-3">
        <View className="flex-1 gap-0.5">
          <Text className="text-sm text-foreground">{t.accesses[access]}</Text>
          <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-secret-${access}-result`}>{secretResults[access] ?? t.noResult}</Text>
        </View>
        <Button className="w-20" testID={`${ID}-secret-${access}-store`} onPress={() => void secret(access, "store")}>{t.store}</Button>
        <Button className="w-20" testID={`${ID}-secret-${access}-read`} onPress={() => void secret(access, "read")}>{t.read}</Button>
        <Button className="w-20" testID={`${ID}-secret-${access}-delete`} onPress={() => void secret(access, "delete")}>{t.remove}</Button>
      </View>)}
      <Text className="text-xs text-muted">{t.driver}</Text>
    </Section>
  </ScrollView>;
}
