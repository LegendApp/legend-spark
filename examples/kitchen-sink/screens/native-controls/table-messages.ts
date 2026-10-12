import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Table and Outline screens. Readouts are JSON from the API, so they are not translated.
export type TableKind = "document" | "image" | "audio" | "archive" | "folder" | "group";
type TableMessages = {
  tableTitle: string;
  outlineTitle: string;
  tableHint: string;
  outlineHint: string;
  columns: { name: string; kind: string; size: string };
  kinds: Record<TableKind, string>;
  readouts: { availability: string; selection: string; sort: string; columns: string; expanded: string; event: string };
  file(number: string): string;
  folder(number: string): string;
  group(number: string): string;
  kilobytes(size: string): string;
  items(count: string): string;
};

const en: TableMessages = {
  tableTitle: "Table",
  outlineTitle: "Outline",
  tableHint: "10,000 rows. Click a header to sort; drag headers to reorder or resize. Shift-click, Command-click, the arrow keys and Command-A select. Double-click or Return activates; Control-click reports a context menu.",
  outlineHint: "10,010 rows in three levels. Click a triangle to expand; Option-click expands a whole branch. Column widths and order belong to the view.",
  columns: { name: "Name", kind: "Kind", size: "Size" },
  kinds: { document: "Document", image: "Image", audio: "Audio", archive: "Archive", folder: "Folder", group: "Group" },
  readouts: { availability: "Availability", selection: "Selection", sort: "Sort", columns: "Columns", expanded: "Expanded", event: "Last event" },
  file: number => `File ${number}`,
  folder: number => `Folder ${number}`,
  group: number => `Group ${number}`,
  kilobytes: size => `${size} KB`,
  items: count => `${count} items`,
};

const ar: TableMessages = {
  tableTitle: "جدول",
  outlineTitle: "مخطط",
  tableHint: "10,000 صف. انقر على عنوان عمود للفرز، واسحب العناوين لإعادة ترتيبها أو تغيير عرضها. يحدد النقر مع Shift أو Command ومفاتيح الأسهم وCommand-A الصفوف. ينشّط النقر المزدوج أو Return الصفوف، ويبلغ النقر مع Control عن قائمة سياقية.",
  outlineHint: "10,010 صفوف في ثلاثة مستويات. انقر على المثلث للتوسيع، ويوسّع النقر مع Option فرعًا كاملًا. عرض الأعمدة وترتيبها يتبعان العرض.",
  columns: { name: "الاسم", kind: "النوع", size: "الحجم" },
  kinds: { document: "مستند", image: "صورة", audio: "صوت", archive: "أرشيف", folder: "مجلد", group: "مجموعة" },
  readouts: { availability: "التوفر", selection: "التحديد", sort: "الفرز", columns: "الأعمدة", expanded: "الموسّع", event: "آخر حدث" },
  file: number => `ملف ${number}`,
  folder: number => `مجلد ${number}`,
  group: number => `مجموعة ${number}`,
  kilobytes: size => `${size} كيلوبايت`,
  items: count => `${count} عنصر`,
};

export const TABLE_MESSAGES: Record<Locale, TableMessages> = { en, ar };
export function useTableMessages() { return TABLE_MESSAGES[useI18n().locale]; }
