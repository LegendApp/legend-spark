import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Dock & taskbar screen. Results and availability are JSON or SparkError codes from
// the API, so flows can assert them in any locale; they are not translated.
export type DockTaskbarMessages = {
  sections: { availability: string; badge: string; progress: string; attention: string; launcher: string };
  hints: { badge: string; progress: string; attention: string; launcher: string };
  badgeText: string;
  setBadgeText: string;
  setBadgeCount: string;
  setBadgeLarge: string;
  clearBadge: string;
  progress35: string;
  progressIndeterminate: string;
  progressPaused: string;
  progressError: string;
  progressInvalid: string;
  clearProgress: string;
  attentionInformational: string;
  attentionCritical: string;
  stopAttention: string;
  installLauncher: string;
  removeLauncher: string;
  lastAction: string;
  menu: { newWindow: string; mute: string; status: string; available: string; away: string };
  noResult: string;
};

const en: DockTaskbarMessages = {
  sections: { availability: "Availability", badge: "Badge", progress: "Progress", attention: "Attention", launcher: "Dock menu and Jump List" },
  hints: {
    badge: "The Dock badge on macOS, the taskbar overlay icon on Windows.",
    progress: "Drawn over the app icon on the Dock tile; on Windows on the taskbar button.",
    attention: "Requests wait 3 seconds, so you can switch to another app first: an active app gets no attention.",
    launcher: "macOS: the Dock menu, with a submenu. Windows: Jump List tasks.",
  },
  badgeText: "New",
  setBadgeText: "Badge “New”",
  setBadgeCount: "Badge count 3",
  setBadgeLarge: "Badge count 1,250",
  clearBadge: "Clear badge",
  progress35: "Progress 35%",
  progressIndeterminate: "Indeterminate",
  progressPaused: "Paused at 60%",
  progressError: "Error at 80%",
  progressInvalid: "Invalid value (150%)",
  clearProgress: "Clear progress",
  attentionInformational: "Informational attention",
  attentionCritical: "Critical attention",
  stopAttention: "Stop attention",
  installLauncher: "Install launcher menu",
  removeLauncher: "Remove launcher menu",
  lastAction: "Last chosen item",
  menu: { newWindow: "New window", mute: "Mute sounds", status: "Status", available: "Available", away: "Away" },
  noResult: "—",
};

const ar: DockTaskbarMessages = {
  sections: { availability: "التوفر", badge: "الشارة", progress: "التقدم", attention: "التنبيه", launcher: "قائمة Dock وقائمة الانتقال" },
  hints: {
    badge: "شارة Dock على macOS، وأيقونة التراكب على شريط المهام في Windows.",
    progress: "يُرسم فوق أيقونة التطبيق في Dock، وعلى زر شريط المهام في Windows.",
    attention: "تنتظر الطلبات 3 ثوانٍ لتنتقل إلى تطبيق آخر أولًا: التطبيق النشط لا يتلقى تنبيهًا.",
    launcher: "macOS: قائمة Dock مع قائمة فرعية. Windows: مهام قائمة الانتقال.",
  },
  badgeText: "جديد",
  setBadgeText: "شارة «جديد»",
  setBadgeCount: "عدد الشارة 3",
  setBadgeLarge: "عدد الشارة 1,250",
  clearBadge: "مسح الشارة",
  progress35: "التقدم 35%",
  progressIndeterminate: "غير محدد",
  progressPaused: "متوقف عند 60%",
  progressError: "خطأ عند 80%",
  progressInvalid: "قيمة غير صالحة (150%)",
  clearProgress: "مسح التقدم",
  attentionInformational: "تنبيه إعلامي",
  attentionCritical: "تنبيه حرج",
  stopAttention: "إيقاف التنبيه",
  installLauncher: "تثبيت قائمة التشغيل",
  removeLauncher: "إزالة قائمة التشغيل",
  lastAction: "آخر عنصر مختار",
  menu: { newWindow: "نافذة جديدة", mute: "كتم الأصوات", status: "الحالة", available: "متاح", away: "بعيد" },
  noResult: "—",
};

export const DOCK_TASKBAR_MESSAGES: Record<Locale, DockTaskbarMessages> = { en, ar };
export function useDockTaskbarMessages() { return DOCK_TASKBAR_MESSAGES[useI18n().locale]; }
