import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Drag & drop features screen. Readouts (availability JSON, operations, counts, file names and error
// codes) are data, so flows can assert them in any locale; they are not translated.
export type DragMessages = {
  sections: { availability: string; promised: string; images: string; operations: string; spring: string };
  promisedHint: string;
  promisedSource: string;
  written: string;
  imagesHint: string;
  imageView: string;
  imageFile: string;
  imageMissing: string;
  operationsHint: string;
  opsSource: string;
  opsFixed: string;
  opsTarget: string;
  springHint: string;
  springTarget: string;
  springs: string;
  highlight: string;
  dropped: string;
  dragEnd: string;
  lastError: string;
  unavailable: string;
  none: string;
};

const en: DragMessages = {
  sections: { availability: "Availability", promised: "Promised files", images: "Drag images", operations: "Operations by modifier key", spring: "Spring loading" },
  promisedHint: "Drag to a Finder folder: the file is written only when the folder accepts it.",
  promisedSource: "Spark Notes.txt",
  written: "Written",
  imagesHint: "Each source drags its text with its own image. A missing image file starts no drag.",
  imageView: "Snapshot of this tile",
  imageFile: "Document icon, 64 × 64",
  imageMissing: "Missing image file",
  operationsHint: "Drop on the target: no key moves, Option copies, Command moves, Control links. Outside the app it only copies.",
  opsSource: "Drag (honors modifier keys)",
  opsFixed: "Drag (ignores modifier keys)",
  opsTarget: "Drop here (move, copy or link)",
  springHint: "Hold a drag over the target: it opens after the system's spring-loading delay.",
  springTarget: "Spring-loaded target",
  springs: "Spring loads",
  highlight: "Highlights",
  dropped: "Dropped",
  dragEnd: "Drag ended",
  lastError: "Last error",
  unavailable: "Not available on this platform.",
  none: "—",
};
const ar: DragMessages = {
  sections: { availability: "التوفر", promised: "الملفات الموعودة", images: "صور السحب", operations: "العمليات حسب مفتاح التعديل", spring: "الفتح النابض" },
  promisedHint: "اسحب إلى مجلد في Finder: لا يُكتب الملف إلا عندما يقبله المجلد.",
  promisedSource: "Spark Notes.txt",
  written: "المكتوب",
  imagesHint: "يسحب كل مصدر نصّه بصورته الخاصة. ملف الصورة المفقود لا يبدأ أي سحب.",
  imageView: "لقطة لهذه البطاقة",
  imageFile: "أيقونة مستند، 64 × 64",
  imageMissing: "ملف صورة مفقود",
  operationsHint: "أفلت على الهدف: بلا مفتاح يُنقل، Option ينسخ، Command ينقل، Control يربط. خارج التطبيق ينسخ فقط.",
  opsSource: "اسحب (يراعي مفاتيح التعديل)",
  opsFixed: "اسحب (يتجاهل مفاتيح التعديل)",
  opsTarget: "أفلت هنا (نقل أو نسخ أو ربط)",
  springHint: "أبقِ السحب فوق الهدف: يُفتح بعد مهلة الفتح النابض في النظام.",
  springTarget: "هدف نابض",
  springs: "مرات الفتح النابض",
  highlight: "حالات التمييز",
  dropped: "المُفلت",
  dragEnd: "انتهاء السحب",
  lastError: "آخر خطأ",
  unavailable: "غير متاح على هذا النظام.",
  none: "—",
};

export const DRAG_MESSAGES: Record<Locale, DragMessages> = { en, ar };
export function useDragMessages() { return DRAG_MESSAGES[useI18n().locale]; }
