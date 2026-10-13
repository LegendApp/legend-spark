import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";
import type { ChoreographyState, ChoreographyWindow, Item, WindowState } from "./window-choreography";

// Strings for the Window choreography screen. Flows assert testIDs, which carry the values in every locale.
export type ChoreographyMessages = {
  title: string;
  availability: string;
  features: Record<"zoom" | "frame" | "closeTransition" | "attach", string>;
  list: string; panel: string; panelText: string; tornOff: string; inspector: string;
  items: Record<Item, string>;
  windows: Record<ChoreographyWindow, string>;
  window(state: WindowState): string;
  attached(value: boolean | null): string;
  animation: Record<ChoreographyState["animation"], string>; animationLabel: string;
  close: Record<ChoreographyState["close"], string>; closeLabel: string;
  reduceMotionLabel: string; reduceMotion(value: boolean | null): string;
  run(runs: number, steps: number): string;
  note: string;
  buttons: Record<"zoom" | "zoom-thumb" | "close" | "stop" | "compact" | "full" | "pane-general" | "pane-advanced" | "tear-off" | "merge" | "inspector" | "palette" | "palette-nudge" | "palette-away" | "palette-back" | "refresh" | "close-all", string>;
};

const en: ChoreographyMessages = {
  title: "Window choreography",
  availability: "Availability",
  features: { zoom: "Zoom from a source", frame: "Animated frames", closeTransition: "Close transitions and focus handoff", attach: "Attached windows" },
  list: "Mailboxes", panel: "Notes panel", panelText: "Pinned notes for this mailbox.", tornOff: "Torn off into a window", inspector: "Inspector",
  items: { inbox: "Inbox", drafts: "Drafts", archive: "Archive" },
  windows: { detail: "Detail", torn: "Torn-off notes", inspector: "Inspector", palette: "Palette" },
  window: state => state ? `${state.visible ? "shown" : "hidden"} on ${state.displayId} at ${state.x},${state.y} size ${state.width}×${state.height}` : "closed",
  attached: value => value === null ? "—" : value ? "docked" : "undocked",
  animationLabel: "Last animation", animation: { none: "—", pending: "running", finished: "finished", interrupted: "interrupted", reduced: "Reduce Motion: faded" },
  closeLabel: "Last close", close: { none: "—", pending: "closing", closed: "closed", interrupted: "interrupted", vetoed: "vetoed" },
  reduceMotionLabel: "Reduce Motion", reduceMotion: value => value === null ? "— (unchanged since opening)" : value ? "on" : "off",
  run: (runs, steps) => `Run ${runs}: ${steps} steps`,
  note: "Driven runs never show these windows; the readout is what the window API reports, refreshed when a step or animation ends.",
  buttons: { zoom: "Open selected mailbox", "zoom-thumb": "Open from thumbnail", close: "Close detail", stop: "Stop animation", compact: "Compact", full: "Full size", "pane-general": "General pane", "pane-advanced": "Advanced pane",
    "tear-off": "Tear off notes", merge: "Merge notes back", inspector: "Attach inspector", palette: "Attach palette", "palette-nudge": "Nudge palette", "palette-away": "Drag palette away",
    "palette-back": "Drag palette back", refresh: "Refresh", "close-all": "Close all" },
};

const n = MESSAGES.ar.number;
const ar: ChoreographyMessages = {
  title: "تنسيق حركة النوافذ",
  availability: "التوفر",
  features: { zoom: "التكبير من مصدر", frame: "إطارات متحركة", closeTransition: "انتقالات الإغلاق وتسليم التركيز", attach: "نوافذ ملحقة" },
  list: "صناديق البريد", panel: "لوحة الملاحظات", panelText: "ملاحظات مثبتة لهذا الصندوق.", tornOff: "مفصولة في نافذة", inspector: "المفتش",
  items: { inbox: "الوارد", drafts: "المسودات", archive: "الأرشيف" },
  windows: { detail: "التفاصيل", torn: "الملاحظات المفصولة", inspector: "المفتش", palette: "لوحة الأدوات" },
  window: state => state ? `${state.visible ? "ظاهرة" : "مخفية"} على ${state.displayId} عند ${n(state.x)}،${n(state.y)} بحجم ${n(state.width)}×${n(state.height)}` : "مغلقة",
  attached: value => value === null ? "—" : value ? "ملتصقة" : "منفصلة",
  animationLabel: "آخر حركة", animation: { none: "—", pending: "جارية", finished: "اكتملت", interrupted: "قُطعت", reduced: "تقليل الحركة: تلاشٍ" },
  closeLabel: "آخر إغلاق", close: { none: "—", pending: "قيد الإغلاق", closed: "أُغلقت", interrupted: "قُطع", vetoed: "رُفض" },
  reduceMotionLabel: "تقليل الحركة", reduceMotion: value => value === null ? "— (لم يتغير منذ الفتح)" : value ? "مُفعّل" : "متوقف",
  run: (runs, steps) => `التشغيل ${n(runs)}: ${n(steps)} خطوات`,
  note: "التشغيل الآلي لا يُظهر هذه النوافذ أبدًا؛ القراءة هي ما تُبلغ عنه واجهة النوافذ، وتُحدَّث عند انتهاء خطوة أو حركة.",
  buttons: { zoom: "فتح الصندوق المحدد", "zoom-thumb": "فتح من صورة مصغرة", close: "إغلاق التفاصيل", stop: "إيقاف الحركة", compact: "مضغوط", full: "الحجم الكامل", "pane-general": "جزء عام", "pane-advanced": "جزء متقدم",
    "tear-off": "فصل الملاحظات", merge: "إعادة دمج الملاحظات", inspector: "إلحاق المفتش", palette: "إلحاق لوحة الأدوات", "palette-nudge": "تحريك اللوحة قليلًا", "palette-away": "سحب اللوحة بعيدًا",
    "palette-back": "إعادة سحب اللوحة", refresh: "تحديث", "close-all": "إغلاق الكل" },
};

export const CHOREOGRAPHY_MESSAGES: Record<Locale, ChoreographyMessages> = { en, ar };
export function useChoreographyMessages() { return CHOREOGRAPHY_MESSAGES[useI18n().locale]; }
