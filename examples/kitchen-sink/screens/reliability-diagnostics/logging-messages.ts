import { useMemo } from "react";
import { useI18n } from "../../shell/app-controller";

// Strings for the Logging screen. Log entries, results and availability are JSON from the API (or
// the app's own log text), so flows can assert them in any locale; they are not translated.
export type LoggingMessages = {
  sections: { availability: string; write: string; files: string; recent: string; diagnostics: string };
  settings(maxFileBytes: number, maxFiles: number): string;
  writeEntries: string;
  writeBurst: string;
  flush: string;
  writeFailure: string;
  exportDiagnostics: string;
  exportHint: string;
  bytes(count: number): string;
  noFiles: string;
  noEntries: string;
  noResult: string;
};

type Format = (value: number) => string;

const en = (number: Format): LoggingMessages => ({
  sections: { availability: "Availability", write: "Write entries", files: "Log files", recent: "Newest entries in app.log", diagnostics: "Diagnostics" },
  settings: (maxFileBytes, maxFiles) => `Level debug · rotates at ${number(maxFileBytes)} bytes · keeps ${number(maxFiles)} files. Entries also go to the unified log (Console).`,
  writeEntries: "Log one entry per level",
  writeBurst: `Log ${number(100)} entries`,
  flush: "Flush",
  writeFailure: "Simulate a write failure",
  exportDiagnostics: "Export diagnostics…",
  exportHint: "A zip of diagnostics.json and the log files, saved where you choose. Nothing is sent anywhere.",
  bytes: count => `${number(count)} bytes`,
  noFiles: "No log files yet",
  noEntries: "No entries yet",
  noResult: "—",
});

const ar = (number: Format): LoggingMessages => ({
  sections: { availability: "التوفر", write: "كتابة الإدخالات", files: "ملفات السجل", recent: "أحدث الإدخالات في app.log", diagnostics: "التشخيص" },
  settings: (maxFileBytes, maxFiles) => `المستوى debug · يُدوَّر عند ${number(maxFileBytes)} بايت · يحتفظ بـ ${number(maxFiles)} ملفات. تذهب الإدخالات أيضًا إلى سجل النظام الموحّد (Console).`,
  writeEntries: "سجّل إدخالًا لكل مستوى",
  writeBurst: `سجّل ${number(100)} إدخال`,
  flush: "تفريغ",
  writeFailure: "محاكاة فشل الكتابة",
  exportDiagnostics: "تصدير التشخيص…",
  exportHint: "ملف zip يضم diagnostics.json وملفات السجل، يُحفظ حيث تختار. لا يُرسل أي شيء إلى أي مكان.",
  bytes: count => `${number(count)} بايت`,
  noFiles: "لا توجد ملفات سجل بعد",
  noEntries: "لا توجد إدخالات بعد",
  noResult: "—",
});

export function useLoggingMessages(): LoggingMessages {
  const { locale, t } = useI18n();
  return useMemo(() => (locale === "ar" ? ar : en)(t.number), [locale, t]);
}
