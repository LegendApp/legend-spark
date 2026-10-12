import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";

// Strings for the System state screen. Event types, thermal states, interfaces, versions, locales,
// time zones, proxies and availability JSON are API data, not translated.
type SystemStateMessages = {
  title: string; intro: string; loading: string; refresh: string; failed: string;
  availability: string; information: string; network: string; events: string;
  osVersion: string; architecture: string; translated: string; locale: string; timeZone: string; appearance: string; idle: string;
  powerSource: string; battery: string; lowPower: string; thermal: string;
  status: string; interfaces: string; expensive: string; constrained: string; proxies: string;
  dark: string; light: string; onBattery: string; onAC: string; seconds: (value: number) => string; noBattery: string; unsupported: string;
  yes: string; no: string; none: string; listening: string; subscribing: string; noEvents: string; injected: string;
};

const en: SystemStateMessages = {
  title: "System state",
  intro: "Power, thermal, network, session, idle and memory state, and the events that report changes to them.",
  loading: "Reading system state…", refresh: "Refresh", failed: "Failed:",
  availability: "Availability", information: "System information", network: "Network", events: "Events",
  osVersion: "OS version", architecture: "Architecture", translated: "Translated (Rosetta)", locale: "Locale", timeZone: "Time zone",
  appearance: "Appearance", idle: "Idle time", powerSource: "Power source", battery: "Battery", lowPower: "Low Power Mode", thermal: "Thermal state",
  status: "Status", interfaces: "Interfaces", expensive: "Expensive", constrained: "Low Data Mode", proxies: "Proxies",
  dark: "Dark", light: "Light", onBattery: "Battery", onAC: "Power adapter", seconds: value => `${value.toFixed(0)} s`, noBattery: "No battery",
  unsupported: "Not available on this platform",
  yes: "Yes", no: "No", none: "None",
  listening: "Listening for system events.", subscribing: "Subscribing to system events…",
  noEvents: "None yet. Events arrive when the system sleeps, wakes, locks, switches users, changes power, thermal or network state, locale, time zone or clock, or comes under memory pressure.",
  injected: "In a test-driver run, flows deliver these events with simulateSystemEvent instead of changing the Mac.",
};

const n = MESSAGES.ar.number;
const ar: SystemStateMessages = {
  title: "حالة النظام",
  intro: "حالة الطاقة والحرارة والشبكة والجلسة والخمول والذاكرة، والأحداث التي تُبلغ عن تغيّرها.",
  loading: "جارٍ قراءة حالة النظام…", refresh: "تحديث", failed: "فشل:",
  availability: "التوفر", information: "معلومات النظام", network: "الشبكة", events: "الأحداث",
  osVersion: "إصدار النظام", architecture: "المعمارية", translated: "مترجَم (Rosetta)", locale: "الإعدادات المحلية", timeZone: "المنطقة الزمنية",
  appearance: "المظهر", idle: "مدة الخمول", powerSource: "مصدر الطاقة", battery: "البطارية", lowPower: "وضع الطاقة المنخفضة", thermal: "الحالة الحرارية",
  status: "الحالة", interfaces: "الواجهات", expensive: "مكلفة", constrained: "وضع البيانات المنخفضة", proxies: "الوكلاء",
  dark: "داكن", light: "فاتح", onBattery: "البطارية", onAC: "محوّل الطاقة", seconds: value => `${n(Math.round(value))} ث`, noBattery: "لا توجد بطارية",
  unsupported: "غير متاح على هذا النظام",
  yes: "نعم", no: "لا", none: "لا شيء",
  listening: "يستمع إلى أحداث النظام.", subscribing: "جارٍ الاشتراك في أحداث النظام…",
  noEvents: "لا شيء بعد. تصل الأحداث عندما ينام النظام أو يستيقظ أو يُقفل أو يتبدّل المستخدم، أو تتغيّر حالة الطاقة أو الحرارة أو الشبكة أو الإعدادات المحلية أو المنطقة الزمنية أو الساعة، أو يقع تحت ضغط الذاكرة.",
  injected: "في تشغيل مشغّل الاختبار، توصل التدفقات هذه الأحداث عبر simulateSystemEvent بدل تغيير جهاز Mac.",
};

export const SYSTEM_STATE_MESSAGES: Record<Locale, SystemStateMessages> = { en, ar };
export function useSystemStateMessages() { return SYSTEM_STATE_MESSAGES[useI18n().locale]; }
