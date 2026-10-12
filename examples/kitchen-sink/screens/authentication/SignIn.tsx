import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui/uniwind";
import { RELYING_PARTY, useSignInDemo } from "./sign-in-demo";
import { useSignInMessages } from "./sign-in-messages";

// Test IDs: authentication-sign-in-availability-apple and -passkeys (Refresh: -availability-refresh); -apple-sign-in,
// -apple-state-check and -apple-cancel with results in -apple-result and -apple-state; -passkey-create, -passkey-get and
// -passkey-cancel with results in -passkey-create-result and -passkey-get-result.
const ID = "authentication-sign-in";

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}`}>{children}</View>
  </View>;
}
function Result({ id, value }: { id: string; value: string }) {
  return <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${id}`}>{value}</Text>;
}

/** Sign in with Apple and passkeys (@legendapp/spark/apple-authentication and /passkeys). */
export function SignIn() {
  const t = useSignInMessages();
  const { availability, results, user, refresh, signIn, checkState, create, assert, cancel } = useSignInDemo();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.availability} id="availability">
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-sm text-foreground">{t.appleAvailability}</Text>
          <Result id="availability-apple" value={availability.apple} />
          <Text className="text-sm text-foreground">{t.passkeyAvailability} {RELYING_PARTY}</Text>
          <Result id="availability-passkeys" value={availability.passkeys} />
        </View>
        <Button className="w-28" testID={`${ID}-availability-refresh`} onPress={refresh}>{t.refresh}</Button>
      </View>
    </Section>
    <Section title={t.apple} id="apple">
      <View className="flex-row flex-wrap gap-2">
        <Button className="w-36" testID={`${ID}-apple-sign-in`} onPress={() => void signIn()}>{t.signIn}</Button>
        <Button className="w-36" testID={`${ID}-apple-state-check`} disabled={!user} onPress={() => void checkState()}>{t.credentialState}</Button>
        <Button className="w-36" testID={`${ID}-apple-cancel`} onPress={cancel}>{t.cancel}</Button>
      </View>
      <Result id="apple-result" value={results.apple ?? t.noResult} />
      <Result id="apple-state" value={results.state ?? (user ? t.noResult : t.noUser)} />
    </Section>
    <Section title={t.passkeys} id="passkeys">
      <Text className="text-sm text-muted">{t.relyingParty}: {RELYING_PARTY}</Text>
      <View className="flex-row flex-wrap gap-2">
        <Button className="w-36" testID={`${ID}-passkey-create`} onPress={() => void create()}>{t.create}</Button>
        <Button className="w-36" testID={`${ID}-passkey-get`} onPress={() => void assert()}>{t.assert}</Button>
        <Button className="w-36" testID={`${ID}-passkey-cancel`} onPress={cancel}>{t.cancel}</Button>
      </View>
      <Result id="passkey-create-result" value={results.create ?? t.noResult} />
      <Result id="passkey-get-result" value={results.get ?? t.noResult} />
    </Section>
    <Text className="text-xs text-muted">{t.driver}</Text>
  </ScrollView>;
}
