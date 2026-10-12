import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the dialogs screen and the dialogs it opens. Results and availability are JSON
// from the API, so flows can assert them in any locale; they are not translated.
export type DialogMessages = {
  sections: { files: string; messages: string; prompts: string; about: string; availability: string };
  open: string;
  save: string;
  readOnly: string;
  format: string;
  formats: { txt: string; md: string; json: string };
  metadata: string;
  emptyTrash: string;
  trashTitle: string;
  trashMessage: string;
  trashConfirm: string;
  cancel: string;
  dontAskAgain: string;
  suppressed(on: boolean): string;
  askAgain: string;
  confirm: string;
  confirmTitle: string;
  confirmMessage: string;
  confirmContinue: string;
  rename: string;
  renameTitle: string;
  renameMessage: string;
  renamePlaceholder: string;
  renameDefault: string;
  renameConfirm: string;
  unlock: string;
  unlockTitle: string;
  unlockMessage: string;
  unlockPlaceholder: string;
  unlockConfirm: string;
  aboutStandard: string;
  aboutOverrides: string;
  aboutName: string;
  aboutCredits: string;
  aboutCopyright: string;
  noResult: string;
};

const en: DialogMessages = {
  sections: { files: "Open and save panels", messages: "Message boxes", prompts: "Text prompts", about: "About panel", availability: "Availability" },
  open: "Open with accessory…",
  save: "Save with format…",
  readOnly: "Open read-only",
  format: "Format:",
  formats: { txt: "Plain text", md: "Markdown", json: "JSON" },
  metadata: "Include metadata",
  emptyTrash: "Empty Trash…",
  trashTitle: "Empty the Trash?",
  trashMessage: "Items in the Trash are deleted immediately.",
  trashConfirm: "Empty Trash",
  cancel: "Cancel",
  dontAskAgain: "Don't ask again",
  suppressed: on => `Don't ask again: ${on ? "on, the Trash empties without asking" : "off"}`,
  askAgain: "Ask again",
  confirm: "Confirm…",
  confirmTitle: "Replace the document?",
  confirmMessage: "The saved version will be replaced.",
  confirmContinue: "Replace",
  rename: "Rename…",
  renameTitle: "Rename document",
  renameMessage: "Enter a new name.",
  renamePlaceholder: "Name",
  renameDefault: "Untitled",
  renameConfirm: "Rename",
  unlock: "Unlock…",
  unlockTitle: "Unlock vault",
  unlockMessage: "Enter the vault password.",
  unlockPlaceholder: "Password",
  unlockConfirm: "Unlock",
  aboutStandard: "Standard About panel",
  aboutOverrides: "About with overrides",
  aboutName: "Spark Kitchen Sink",
  aboutCredits: "Built with Legend Spark.",
  aboutCopyright: "© 2026 Legend",
  noResult: "—",
};

const ar: DialogMessages = {
  sections: { files: "لوحات الفتح والحفظ", messages: "مربعات الرسائل", prompts: "طلبات إدخال النص", about: "لوحة حول", availability: "التوفر" },
  open: "فتح مع عناصر إضافية…",
  save: "حفظ بتنسيق…",
  readOnly: "فتح للقراءة فقط",
  format: "التنسيق:",
  formats: { txt: "نص عادي", md: "ماركداون", json: "JSON" },
  metadata: "تضمين البيانات الوصفية",
  emptyTrash: "إفراغ سلة المهملات…",
  trashTitle: "هل تريد إفراغ سلة المهملات؟",
  trashMessage: "تُحذف العناصر في سلة المهملات فورًا.",
  trashConfirm: "إفراغ سلة المهملات",
  cancel: "إلغاء",
  dontAskAgain: "عدم السؤال مرة أخرى",
  suppressed: on => `عدم السؤال مرة أخرى: ${on ? "مفعّل، تُفرغ السلة دون سؤال" : "متوقف"}`,
  askAgain: "اسأل مرة أخرى",
  confirm: "تأكيد…",
  confirmTitle: "هل تريد استبدال المستند؟",
  confirmMessage: "سيتم استبدال النسخة المحفوظة.",
  confirmContinue: "استبدال",
  rename: "إعادة تسمية…",
  renameTitle: "إعادة تسمية المستند",
  renameMessage: "أدخل اسمًا جديدًا.",
  renamePlaceholder: "الاسم",
  renameDefault: "بلا عنوان",
  renameConfirm: "إعادة تسمية",
  unlock: "فتح القفل…",
  unlockTitle: "فتح قفل الخزنة",
  unlockMessage: "أدخل كلمة سر الخزنة.",
  unlockPlaceholder: "كلمة السر",
  unlockConfirm: "فتح القفل",
  aboutStandard: "لوحة حول القياسية",
  aboutOverrides: "لوحة حول مع قيم مخصصة",
  aboutName: "Spark Kitchen Sink",
  aboutCredits: "صُنع باستخدام Legend Spark.",
  aboutCopyright: "© 2026 Legend",
  noResult: "—",
};

export const DIALOG_MESSAGES: Record<Locale, DialogMessages> = { en, ar };
export function useDialogMessages() { return DIALOG_MESSAGES[useI18n().locale]; }
