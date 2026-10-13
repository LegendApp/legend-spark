import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui/uniwind";
import { HELPER, usePrivilegedHelperDemo } from "./privileged-helper-demo";
import { usePrivilegedHelperMessages } from "./privileged-helper-messages";

// Test IDs: processes-ipc-privileged-helper-availability (Refresh: -refresh) and -status; -register, -unregister and
// -open-settings with results in -registration-result; -authorize and -release with results in -authorization-result;
// -send and -send-authorized with replies in -message-result.
const ID = "processes-ipc-privileged-helper";

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}-section`}>{children}</View>
  </View>;
}
function Result({ id, value }: { id: string; value: string }) {
  return <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${id}`}>{value}</Text>;
}

/** The privileged helper, the admin prompt and XPC (@legendapp/spark/privileged-helper). */
export function PrivilegedHelper() {
  const t = usePrivilegedHelperMessages();
  const { availability, results, held, refresh, register, unregister, openSettings, authorize, release, send } = usePrivilegedHelperDemo();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.availability} id="availability">
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-1">
          <Result id="availability" value={availability} />
          <Text className="text-sm text-foreground">{t.status}: {HELPER}</Text>
          <Result id="status" value={results.status ?? t.noResult} />
        </View>
        <Button className="w-28" testID={`${ID}-refresh`} onPress={() => void refresh()}>{t.refresh}</Button>
      </View>
    </Section>
    <Section title={t.helper} id="helper">
      <View className="flex-row flex-wrap gap-2">
        <Button className="w-36" testID={`${ID}-register`} onPress={() => void register()}>{t.register}</Button>
        <Button className="w-36" testID={`${ID}-unregister`} onPress={() => void unregister()}>{t.unregister}</Button>
        <Button className="w-44" testID={`${ID}-open-settings`} onPress={() => void openSettings()}>{t.openSettings}</Button>
      </View>
      <Result id="registration-result" value={results.registration ?? t.noResult} />
    </Section>
    <Section title={t.admin} id="admin">
      <View className="flex-row flex-wrap gap-2">
        <Button className="w-44" testID={`${ID}-authorize`} onPress={() => void authorize()}>{t.authorize}</Button>
        <Button className="w-44" testID={`${ID}-release`} disabled={!held} onPress={() => void release()}>{t.release}</Button>
      </View>
      <Text className="text-sm text-muted">{held ? t.held : t.notHeld}</Text>
      <Result id="authorization-result" value={results.authorization ?? t.noResult} />
    </Section>
    <Section title={t.messages} id="messages">
      <View className="flex-row flex-wrap gap-2">
        <Button className="w-36" testID={`${ID}-send`} onPress={() => void send(false)}>{t.send}</Button>
        <Button className="w-48" testID={`${ID}-send-authorized`} disabled={!held} onPress={() => void send(true)}>{t.sendAuthorized}</Button>
      </View>
      <Result id="message-result" value={results.message ?? t.noResult} />
    </Section>
    <Text className="text-xs text-muted">{t.driver}</Text>
  </ScrollView>;
}
