import { ScrollView, Text } from "react-native";
import { getCalendars, getLocales } from "expo-localization";

// Test ID: internationalization-expo-localization-ready when the native module returns a locale with a
// language tag and a calendar with a time zone.
const ID = "internationalization-expo-localization";

/** expo-localization through its own API; Spark's patch adds the macOS build. */
export function ExpoLocalizationDemo() {
  const [locale] = getLocales();
  const [calendar] = getCalendars();
  const ready = !!locale?.languageTag && !!calendar?.timeZone;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text selectable className="font-mono text-xs text-muted">{JSON.stringify({ locale, calendar }, null, 2)}</Text>
    <Text className="font-mono text-xs text-foreground" testID={ready ? `${ID}-ready` : undefined}>{ready ? `${locale!.languageTag}, ${calendar!.timeZone}` : "missing locale or calendar"}</Text>
  </ScrollView>;
}
