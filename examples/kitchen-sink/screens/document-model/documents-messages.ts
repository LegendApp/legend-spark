import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";
import type { DocumentCheck } from "./documents-demo";

// Strings for the Documents screen. Results are error codes and file names from the API, so flows can
// assert them in any locale.
export type DocumentsMessages = {
  title: string;
  intro: string;
  untitled(number: number): string;
  /** The first document starts untitled with this text, so it opens edited (the window shows the edited dot). */
  sample: string;
  copyName(name: string, number: number): string;
  sections: { availability: string; document: string; operations: string; versions: string; checks: string; duplicate: string };
  state: { path: string; untitled: string; edited: string; saved: string; locked: string; readOnly: string; conflict: string; autosave: string };
  actions: {
    newDocument: string; edit: string; saveAs: string; save: string; overwrite: string; duplicate: string; rename: string; moveTo: string;
    revert: string; lock: string; unlock: string; externalChange: string; close: string; refreshVersions: string; restore: string; runAll: string;
  };
  close: { title: string; message(name: string): string; save: string; discard: string; cancel: string };
  noVersions: string;
  result(value: string): string;
  checks: Record<DocumentCheck, string>;
  running: string;
};

const en: DocumentsMessages = {
  title: "Documents",
  intro: "One document session on a temporary file: dirty tracking drives this window's edited dot and proxy icon, saves are conflict-checked inside a file coordination claim, and autosave writes in place.",
  untitled: number => number === 1 ? "Untitled" : `Untitled ${number}`,
  sample: "Draft notes, not saved yet.\n",
  copyName: (name, number) => number === 1 ? `${name} copy` : `${name} copy ${number}`,
  sections: { availability: "Availability", document: "Document", operations: "Operations", versions: "Versions", checks: "Checks", duplicate: "Duplicate" },
  state: { path: "Path", untitled: "untitled", edited: "Edited", saved: "Saved", locked: "Locked", readOnly: "Read-only", conflict: "Changed on disk", autosave: "Autosave in place after 0.8 s" },
  actions: {
    newDocument: "New document", edit: "Type a line", saveAs: "Save As Document.txt", save: "Save", overwrite: "Save, replacing the disk version",
    duplicate: "Duplicate", rename: "Rename to Renamed.txt", moveTo: "Move To Archive", revert: "Revert to Saved", lock: "Lock", unlock: "Unlock",
    externalChange: "Change the file in another app", close: "Close document…", refreshVersions: "Save a version", restore: "Restore", runAll: "Run all checks",
  },
  close: { title: "Save changes?", message: name => `Do you want to keep the changes you made to “${name}”?`, save: "Save", discard: "Don't Save", cancel: "Cancel" },
  noVersions: "No saved versions yet.",
  result: value => `Last result: ${value}`,
  checks: {
    untitled: "Untitled numbering reuses the lowest free number",
    edited: "Edits mark the document edited (window edited dot)",
    saveAs: "Save As writes the file and continues there",
    save: "Save writes in place and clears edited",
    conflict: "A save over a changed file reports a conflict; overwrite resolves it",
    external: "An external change reloads a clean document",
    autosave: "Autosave writes in place after the delay",
    duplicate: "Duplicate opens an untitled copy with the contents",
    rename: "Rename moves the file within its folder",
    moveTo: "Move To moves the file into another folder",
    revert: "Revert to Saved discards edits",
    versions: "Versions list saved states and restore one",
    locked: "A locked document refuses saves with E_READ_ONLY",
    reopen: "Opening an open document focuses its window",
  },
  running: "Running…",
};

const n = MESSAGES.ar.number;
const ar: DocumentsMessages = {
  title: "المستندات",
  intro: "جلسة مستند واحدة على ملف مؤقت: تتبّع التعديلات يحرّك نقطة التعديل في هذه النافذة وأيقونة الملف، ويُتحقق من تعارض الحفظ داخل تنسيق الملفات، ويحفظ الحفظ التلقائي في المكان.",
  untitled: number => number === 1 ? "بلا عنوان" : `بلا عنوان ${n(number)}`,
  sample: "مسودة ملاحظات لم تُحفظ بعد.\n",
  copyName: (name, number) => number === 1 ? `نسخة من ${name}` : `نسخة ${n(number)} من ${name}`,
  sections: { availability: "التوفر", document: "المستند", operations: "العمليات", versions: "الإصدارات", checks: "الفحوص", duplicate: "النسخة" },
  state: { path: "المسار", untitled: "بلا عنوان", edited: "معدَّل", saved: "محفوظ", locked: "مقفل", readOnly: "للقراءة فقط", conflict: "تغيّر على القرص", autosave: "حفظ تلقائي في المكان بعد 0.8 ث" },
  actions: {
    newDocument: "مستند جديد", edit: "اكتب سطرًا", saveAs: "حفظ باسم Document.txt", save: "حفظ", overwrite: "حفظ واستبدال نسخة القرص",
    duplicate: "تكرار", rename: "إعادة التسمية إلى Renamed.txt", moveTo: "نقل إلى Archive", revert: "الرجوع إلى المحفوظ", lock: "قفل", unlock: "إلغاء القفل",
    externalChange: "تغيير الملف من تطبيق آخر", close: "إغلاق المستند…", refreshVersions: "حفظ إصدار", restore: "استعادة", runAll: "تشغيل كل الفحوص",
  },
  close: { title: "هل تريد حفظ التغييرات؟", message: name => `هل تريد الاحتفاظ بالتغييرات التي أجريتها على «${name}»؟`, save: "حفظ", discard: "عدم الحفظ", cancel: "إلغاء" },
  noVersions: "لا توجد إصدارات محفوظة بعد.",
  result: value => `آخر نتيجة: ${value}`,
  checks: {
    untitled: "ترقيم المستندات بلا عنوان يعيد استخدام أصغر رقم متاح",
    edited: "التعديلات تجعل المستند معدَّلًا (نقطة التعديل في النافذة)",
    saveAs: "الحفظ باسم يكتب الملف ويتابع فيه",
    save: "الحفظ يكتب في المكان ويزيل حالة التعديل",
    conflict: "الحفظ فوق ملف متغيّر يبلّغ عن تعارض، والاستبدال يحلّه",
    external: "التغيير الخارجي يعيد تحميل المستند غير المعدَّل",
    autosave: "الحفظ التلقائي يكتب في المكان بعد المهلة",
    duplicate: "التكرار يفتح نسخة بلا عنوان بالمحتوى نفسه",
    rename: "إعادة التسمية تنقل الملف داخل مجلده",
    moveTo: "النقل ينقل الملف إلى مجلد آخر",
    revert: "الرجوع إلى المحفوظ يتجاهل التعديلات",
    versions: "الإصدارات تعرض الحالات المحفوظة وتستعيد إحداها",
    locked: "المستند المقفل يرفض الحفظ بالرمز E_READ_ONLY",
    reopen: "فتح مستند مفتوح يُبرز نافذته",
  },
  running: "جارٍ التشغيل…",
};

export const DOCUMENTS_MESSAGES: Record<Locale, DocumentsMessages> = { en, ar };
export function useDocumentsMessages() { return DOCUMENTS_MESSAGES[useI18n().locale]; }
