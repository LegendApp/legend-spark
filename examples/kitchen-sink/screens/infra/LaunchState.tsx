import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import { MARK_FLAG, useLaunchState } from "./launch-state";

// Test IDs: infra-launch-state-<field>. Each state has its own ID, because the driver checks IDs, not text.
const ID = "infra-launch-state";

type Messages = {
  title: string; intro: string; loading: string; setting: string; recent: string; frame: string; arguments: string; files: string;
  found: string; notFound: string; restored: string; notRestored: string; marked: string; none: string;
};
const MESSAGES: Record<Locale, Messages> = {
  en: {
    title: "Launch state", loading: "Reading launch state…",
    intro: `What this launch found from earlier launches. Launch with ${MARK_FLAG} to save a setting and a recent document and to resize the main window; launchApp clearState deletes the setting and the document. A test-driver launch never saves the window size.`,
    setting: "Saved setting", recent: "Recent document", frame: "Main window size", arguments: "Launch arguments", files: "Opened files",
    found: "Found", notFound: "Not found", restored: "Restored", notRestored: "Not restored",
    marked: "This launch saved the setting and the document and resized the window.", none: "None",
  },
  ar: {
    title: "حالة التشغيل", loading: "جارٍ قراءة حالة التشغيل…",
    intro: `ما وجده هذا التشغيل من عمليات تشغيل سابقة. شغّل التطبيق مع ‎${MARK_FLAG} لحفظ إعداد ومستند حديث ولتغيير حجم النافذة الرئيسية؛ يحذف clearState في launchApp الإعداد والمستند. لا يحفظ التشغيل عبر مشغّل الاختبار حجم النافذة أبدًا.`,
    setting: "الإعداد المحفوظ", recent: "المستند الحديث", frame: "حجم النافذة الرئيسية", arguments: "وسائط التشغيل", files: "الملفات المفتوحة",
    found: "موجود", notFound: "غير موجود", restored: "مستعاد", notRestored: "غير مستعاد",
    marked: "حفظ هذا التشغيل الإعداد والمستند وغيّر حجم النافذة.", none: "لا شيء",
  },
};

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-x-3 gap-y-1">
    <Text className="w-40 text-sm text-muted">{label}</Text>
    <Text selectable className="flex-1 text-sm text-foreground" testID={`${ID}-${id}`}>{children}</Text>
  </View>;
}

/** Persisted state found at launch (a setting, a recent document, the main window frame), launch arguments and opened files. */
export function LaunchState() {
  const t = MESSAGES[useI18n().locale];
  const { state, files, error } = useLaunchState();
  const list = (items: readonly string[]) => items.length ? items.join("\n") : t.none;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <View className="gap-2 rounded-md border border-border p-3">
      {state ? <>
        <Field label={t.setting} id={state.setting ? "setting-found" : "setting-absent"}>{state.setting ? t.found : t.notFound}</Field>
        <Field label={t.recent} id={state.recent ? "recent-found" : "recent-absent"}>{state.recent ? t.found : t.notFound}</Field>
        <Field label={t.frame} id={state.frame ? "frame-restored" : "frame-default"}>{state.frame ? t.restored : t.notRestored}</Field>
        <Field label={t.arguments} id="arguments">{list(state.arguments)}</Field>
        {state.marked && <Text className="text-sm text-foreground" testID={`${ID}-marked`}>{t.marked}</Text>}
      </> : !error && <Text className="text-sm text-muted">{t.loading}</Text>}
      <Field label={t.files} id={files.length ? "opened-files" : "no-files"}>{list(files)}</Field>
      {error && <Text selectable className="text-sm text-danger" testID={`${ID}-error`}>{error}</Text>}
    </View>
  </ScrollView>;
}
