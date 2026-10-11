import { ScrollView, Text, View } from "react-native";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

const MONTHS: Record<Locale, readonly string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
};
const HINT: Record<Locale, string> = {
  en: "Month 1 starts at the leading edge. Scroll toward the trailing edge for the rest.",
  ar: "يبدأ الشهر ١ من بداية السطر. مرّر نحو نهايته لرؤية البقية.",
};

// The months overflow the window, so the strip's start position and text direction are visible.
export function ScrollDirection() {
  const { locale, t } = useI18n();
  return <View className="gap-3 p-6">
    <Text className="text-sm text-muted" testID="internationalization-scroll-direction-hint">{HINT[locale]}</Text>
    <ScrollView horizontal testID="internationalization-scroll-direction-strip" contentContainerClassName="gap-3">
      {MONTHS[locale].map((month, index) => <View key={month} className="w-40 gap-1 rounded-lg border border-border bg-surface p-4">
        <Text className="text-2xl font-bold text-foreground">{t.number(index + 1)}</Text>
        <Text className="text-foreground">{month}</Text>
      </View>)}
    </ScrollView>
  </View>;
}
