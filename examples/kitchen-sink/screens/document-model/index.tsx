import { defineScreens } from "../../shell/registry";
import { Documents } from "./Documents";
import { DOCUMENTS_MESSAGES } from "./documents-messages";
import { Printing } from "./Printing";

export default defineScreens("document-model", [
  { id: "documents", title: "Documents", titles: { ar: DOCUMENTS_MESSAGES.ar.title }, summary: "A document session on a temp file: untitled numbering, edited dot, Save/Save As with conflict checks, autosave in place, Duplicate, Rename, Move To, Revert, NSFileVersion versions and locking.", summaries: { ar: "جلسة مستند على ملف مؤقت: ترقيم المستندات بلا عنوان، ونقطة التعديل، والحفظ والحفظ باسم مع فحص التعارض، والحفظ التلقائي في المكان، والتكرار وإعادة التسمية والنقل والرجوع إلى المحفوظ، وإصدارات NSFileVersion والقفل." }, component: Documents },
  { id: "printing", title: "Printing", titles: { ar: "الطباعة" }, summary: "Print a report, this window or one view with the print panel's live preview; page setup kept in app settings; headless PDF export.", summaries: { ar: "طباعة تقرير أو هذه النافذة أو عرض واحد مع المعاينة الحية في لوحة الطباعة؛ وإعداد صفحة يُحفظ في إعدادات التطبيق؛ وتصدير PDF بلا واجهة." }, component: Printing },
]);
