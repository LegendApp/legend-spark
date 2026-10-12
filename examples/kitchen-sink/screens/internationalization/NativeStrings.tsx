import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "../../Controls";
import { useNativeStringsMessages } from "./native-strings-messages";
import { useAppLanguages } from "./useAppLanguages";

// Test IDs: internationalization-native-strings-<field>. Values are what @legendapp/spark/app reports.
const ID = "internationalization-native-strings";

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-x-3 gap-y-1">
    <Text className="w-48 text-sm text-muted">{label}</Text>
    <Text selectable className="flex-1 text-sm text-foreground" testID={`${ID}-${id}`}>{children}</Text>
  </View>;
}

/** The app's languages, the per-app language, and Spark's own dialog labels in the current language. */
export function NativeStrings() {
  const t = useNativeStringsMessages();
  const { availability, languages, error, status, choose, relaunch, confirmed, confirmWithDefaults } = useAppLanguages();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-root`}>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <View className="gap-2 rounded-md border border-border p-3">
      <Field label={t.availability} id="availability">{JSON.stringify(availability)}</Field>
      {languages ? <>
        <Field label={t.supported} id="supported">{languages.supported.join(", ")}</Field>
        <Field label={t.current} id="current">{languages.current}</Field>
        <Field label={t.override} id="override">{languages.override ?? t.followsSystem}</Field>
        <Field label={t.framework} id="framework">{languages.framework.join(", ")}</Field>
      </> : !error && <Text className="text-sm text-muted">{t.loading}</Text>}
      {error && <Text selectable className="text-sm text-danger" testID={`${ID}-error`}>{error}</Text>}
    </View>
    <Text className="text-sm text-muted">{t.choose}</Text>
    <View className="flex-row flex-wrap gap-3">
      {languages?.supported.map(language => <Button key={language} testID={`${ID}-use-${language}`} onPress={() => void choose(language)}>{t.use(language)}</Button>)}
      <Button testID={`${ID}-follow-system`} onPress={() => void choose(null)}>{t.followSystem}</Button>
      <Button testID={`${ID}-relaunch`} onPress={() => void relaunch()}>{t.relaunch}</Button>
    </View>
    {status && <Text selectable className={`text-sm ${"error" in status ? "text-danger" : "text-foreground"}`} testID={`${ID}-status`}>{"error" in status ? `${t.failed} ${status.error}` : t.saved(status.saved)}</Text>}
    <Text className="text-sm text-muted">{t.dialogs}</Text>
    <Button testID={`${ID}-confirm`} onPress={() => void confirmWithDefaults(t.confirmMessage)}>{t.confirm}</Button>
    {confirmed !== undefined && <Text className="text-sm text-foreground" testID={`${ID}-confirm-result`}>{confirmed ? t.confirmed : t.canceled}</Text>}
  </ScrollView>;
}
