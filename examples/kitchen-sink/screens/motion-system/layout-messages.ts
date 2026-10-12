import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Layout, presence and shared elements screen (kept apart from motion-messages.ts).
type LayoutMessages = {
  presence: string;
  presenceHint: string;
  add: string;
  removeFirst: string;
  lastToTop: string;
  item(id: number): string;
  frame: string;
  frameHint: string;
  toggleSize: string;
  shared: string;
  sharedHint: string;
  open(id: number): string;
  close: string;
};

const en: LayoutMessages = {
  presence: "Presence and reflow",
  presenceHint: "A removed row plays its exit and stays until it settles; then the rows below slide up. Added rows enter. Moving the last row to the top reflows every row.",
  add: "Add row",
  removeFirst: "Remove first",
  lastToTop: "Move last to top",
  item: id => `Item ${id}`,
  frame: "Layout frame",
  frameHint: "The box changes width; it scales from its previous frame to the new one.",
  toggleSize: "Toggle size",
  shared: "Shared element",
  sharedHint: "Opening a photo unmounts its thumbnail; the detail view with the same shared id animates from it.",
  open: id => `Open ${id}`,
  close: "Close",
};

const arabicDigits = (value: number) => String(value).replace(/\d/g, digit => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!);
const ar: LayoutMessages = {
  presence: "الظهور وإعادة التدفق",
  presenceHint: "يشغّل الصف المحذوف حركة خروجه ويبقى حتى تستقر، ثم تنزلق الصفوف التي تحته إلى الأعلى. تدخل الصفوف المضافة. نقل الصف الأخير إلى الأعلى يعيد ترتيب كل الصفوف.",
  add: "إضافة صف",
  removeFirst: "حذف الأول",
  lastToTop: "نقل الأخير إلى الأعلى",
  item: id => `العنصر ${arabicDigits(id)}`,
  frame: "إطار التخطيط",
  frameHint: "يتغير عرض المربع؛ فيتحجّم من إطاره السابق إلى الجديد.",
  toggleSize: "تبديل الحجم",
  shared: "عنصر مشترك",
  sharedHint: "يؤدي فتح صورة إلى إزالة صورتها المصغرة؛ فيتحرك عرض التفاصيل الذي يحمل المعرّف المشترك نفسه منها.",
  open: id => `فتح ${arabicDigits(id)}`,
  close: "إغلاق",
};

export const LAYOUT_MESSAGES: Record<Locale, LayoutMessages> = { en, ar };
export function useLayoutMessages() { return LAYOUT_MESSAGES[useI18n().locale]; }
