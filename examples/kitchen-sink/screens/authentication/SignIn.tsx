import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { AppleSignInButton, type AppleSignInButtonStyle, type AppleSignInButtonType } from "@legendapp/spark/apple-authentication";
import { Button } from "@legendapp/spark/ui/uniwind";
import { RELYING_PARTY, SIGN_IN_OPTIONS, appleButtonDraws, useSignInDemo } from "./sign-in-demo";
import { useSignInMessages } from "./sign-in-messages";

// Test IDs: authentication-sign-in-availability-apple and -passkeys (Refresh: -availability-refresh); -apple-sign-in
// (Apple's button on macOS, the app handling the press; a plain button on Windows), the variants -apple-button-continue,
// -apple-button-sign-up and -apple-button-outline (the button runs the request), -apple-state-check and -apple-cancel,
// with results in -apple-result and -apple-state; -passkey-create, -passkey-get and
// -passkey-cancel with results in -passkey-create-result and -passkey-get-result; -availability-features; -security-key-create
// and -security-key-get (-security-key-result), -extensions-create and -extensions-get (-extensions-result),
// -immediate-get (-immediate-result), -combined (-combined-result) and -signal-unknown (-signal-result).
const ID = "authentication-sign-in";
const BUTTON_SIZE = { width: 220, height: 32 };
/** Apple's other titles and styles; each press runs signInWithApple through the button. */
const VARIANTS: { id: string; buttonType: AppleSignInButtonType; buttonStyle: AppleSignInButtonStyle; cornerRadius?: number }[] = [
  { id: "continue", buttonType: "continue", buttonStyle: "black" },
  { id: "sign-up", buttonType: "signUp", buttonStyle: "white" },
  { id: "outline", buttonType: "signIn", buttonStyle: "whiteOutline", cornerRadius: 16 },
];

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
  const { availability, results, user, refresh, signIn, onSignIn, onSignInError, checkState, create, assert, cancel,
    createOnSecurityKey, assertWithSecurityKey, createWithExtensions, assertWithExtensions, assertImmediately, signInEither, signalUnknown } = useSignInDemo();
  const action = (id: string, label: string, onPress: () => void) => <Button className="w-44" testID={`${ID}-${id}`} onPress={onPress}>{label}</Button>;
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
          <Text className="text-sm text-foreground">{t.featureAvailability}</Text>
          <Result id="availability-features" value={availability.features} />
        </View>
        <Button className="w-28" testID={`${ID}-availability-refresh`} onPress={refresh}>{t.refresh}</Button>
      </View>
    </Section>
    <Section title={t.apple} id="apple">
      {appleButtonDraws() ? <View className="flex-row flex-wrap gap-2">
        <AppleSignInButton testID={`${ID}-apple-sign-in`} style={BUTTON_SIZE} onPress={({ windowId }) => void signIn(windowId)} />
        {VARIANTS.map(({ id, ...variant }) => <AppleSignInButton key={id} testID={`${ID}-apple-button-${id}`} style={BUTTON_SIZE} {...variant}
          signInOptions={SIGN_IN_OPTIONS} onSignIn={onSignIn} onError={onSignInError} />)}
      </View> : <Button className="w-36" testID={`${ID}-apple-sign-in`} onPress={() => void signIn()}>{t.signIn}</Button>}
      <View className="flex-row flex-wrap gap-2">
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
    <Section title={t.more} id="more">
      <View className="flex-row flex-wrap gap-2">
        {action("security-key-create", t.securityKeyCreate, () => void createOnSecurityKey())}
        {action("security-key-get", t.securityKeyGet, () => void assertWithSecurityKey())}
      </View>
      <Result id="security-key-result" value={results.securityKey ?? t.noResult} />
      <View className="flex-row flex-wrap gap-2">
        {action("extensions-create", t.extensionsCreate, () => void createWithExtensions())}
        {action("extensions-get", t.extensionsGet, () => void assertWithExtensions())}
      </View>
      <Result id="extensions-result" value={results.extensions ?? t.noResult} />
      <View className="flex-row flex-wrap gap-2">
        {action("immediate-get", t.immediate, () => void assertImmediately())}
        {action("combined", t.combined, () => void signInEither())}
        {action("signal-unknown", t.signal, () => void signalUnknown())}
      </View>
      <Result id="immediate-result" value={results.immediate ?? t.noResult} />
      <Result id="combined-result" value={results.combined ?? t.noResult} />
      <Result id="signal-result" value={results.signal ?? t.noResult} />
    </Section>
    <Text className="text-xs text-muted">{t.driver}</Text>
  </ScrollView>;
}
