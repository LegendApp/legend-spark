import { Text, View } from "react-native";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

const ALIGNMENTS = [undefined, "auto", "left", "right"] as const;
const SAMPLE: Record<Locale, string> = {
  en: "Text in a full-width box.",
  ar: "نص في مربع بعرض كامل.",
};
const HINT: Record<Locale, string> = {
  en: "With no textAlign, or auto, text starts at the leading edge. As on iOS, left and right swap in right-to-left layouts.",
  ar: "بدون textAlign أو مع auto يبدأ النص من بداية السطر. كما في iOS، تتبادل left وright في التخطيط من اليمين إلى اليسار.",
};

// Each box spans the screen, so the alignment of its text is visible.
export function TextAlignment() {
  const { locale } = useI18n();
  return <View className="gap-3 p-6">
    <Text className="text-sm text-muted" testID="internationalization-text-alignment-hint">{HINT[locale]}</Text>
    {ALIGNMENTS.map(textAlign => <View key={textAlign ?? "default"} className="gap-1 rounded-lg border border-border bg-surface p-4" testID={`internationalization-text-alignment-${textAlign ?? "default"}`}>
      <Text className="font-mono text-sm text-muted" style={{ textAlign }}>{textAlign ? `textAlign: "${textAlign}"` : "textAlign: undefined"}</Text>
      <Text className="text-foreground" style={{ textAlign }}>{SAMPLE[locale]}</Text>
    </View>)}
  </View>;
}
