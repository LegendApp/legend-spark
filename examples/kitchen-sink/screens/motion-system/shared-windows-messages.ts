import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";
import type { ViewMotion } from "./shared-windows-demo";

// Strings for the Cross-window shared elements screen and its photo window. Flows assert testIDs, which carry the
// values in every locale.
type SharedWindowsMessages = {
  title: string;
  summary: string;
  hint: string;
  open(photo: number): string;
  close: string;
  windowTitle(photo: number): string;
  caption(photo: number): string;
  reduceMotionLabel: string;
  reduceMotion(value: boolean | null): string;
  windowLabel: string;
  window: Record<"open" | "closed", string>;
  photoLabel: string;
  thumbLabel(photo: number): string;
  motion(value: ViewMotion): string;
};

const en: SharedWindowsMessages = {
  title: "Cross-window shared elements",
  summary: "A thumbnail opens a window that zooms out of it while the photo flies into the window; closing the window flies the photo back into its thumbnail.",
  hint: "The photo flies between the windows in a window of its own, above both; the thumbnail and the photo hide while it flies. Reduce Motion fades the photo in instead.",
  open: photo => `Open photo ${photo}`,
  close: "Close photo window",
  windowTitle: photo => `Photo ${photo}`,
  caption: photo => `Photo ${photo}, flown in from its thumbnail`,
  reduceMotionLabel: "Reduce Motion",
  reduceMotion: value => value === null ? "unknown" : value ? "on" : "off",
  windowLabel: "Photo window",
  window: { open: "open", closed: "closed" },
  photoLabel: "Photo",
  thumbLabel: photo => `Thumbnail ${photo}`,
  motion: value => value ? `${value.moving ? "moving" : "still"}, scale ${value.scale}, opacity ${value.opacity}` : "not mounted",
};

const n = MESSAGES.ar.number;
const ar: SharedWindowsMessages = {
  title: "عناصر مشتركة بين النوافذ",
  summary: "تفتح صورة مصغرة نافذة تتكبّر منها بينما تطير الصورة إلى النافذة، ويؤدي إغلاق النافذة إلى إعادة الصورة طائرةً إلى صورتها المصغرة.",
  hint: "تطير الصورة بين النافذتين في نافذة خاصة بها فوقهما، وتختفي الصورة المصغرة والصورة أثناء الطيران. مع تقليل الحركة تظهر الصورة تدريجيًا بدلًا من ذلك.",
  open: photo => `فتح الصورة ${n(photo)}`,
  close: "إغلاق نافذة الصورة",
  windowTitle: photo => `الصورة ${n(photo)}`,
  caption: photo => `الصورة ${n(photo)}، طارت إلى هنا من صورتها المصغرة`,
  reduceMotionLabel: "تقليل الحركة",
  reduceMotion: value => value === null ? "غير معروف" : value ? "مفعّل" : "معطّل",
  windowLabel: "نافذة الصورة",
  window: { open: "مفتوحة", closed: "مغلقة" },
  photoLabel: "الصورة",
  thumbLabel: photo => `الصورة المصغرة ${n(photo)}`,
  motion: value => value ? `${value.moving ? "تتحرك" : "ساكنة"}، المقياس ${value.scale}، العتامة ${value.opacity}` : "غير مركّبة",
};

export const SHARED_WINDOWS_MESSAGES: Record<Locale, SharedWindowsMessages> = { en, ar };
export function useSharedWindowsMessages() { return SHARED_WINDOWS_MESSAGES[useI18n().locale]; }
