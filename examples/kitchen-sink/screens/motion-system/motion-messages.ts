import type { SpringPreset } from "@legendapp/spark/motion";
import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";

// Strings for the motion screens. Readouts are JSON from the API, so they are not translated.
type MotionMessages = {
  availability: string;
  presets: string;
  presetNames: Record<SpringPreset, string>;
  play: string;
  interruption: string;
  interruptionHint: string;
  start: string;
  interrupt: string;
  release: string;
  stop: string;
  reset: string;
  keyframes: string;
  sequence: string;
  stagger: string;
  timeline: string;
  decay: string;
  run: string;
  flingBack: string;
  scrollLink: string;
  scrollHint: string;
  link: string;
  unlink: string;
  readBadge: string;
  row(index: number): string;
  frames: string;
  framesHint: string;
  blockJs: string;
};

const en: MotionMessages = {
  availability: "Availability",
  presets: "Spring presets",
  presetNames: { default: "Default", smooth: "Smooth", snappy: "Snappy", bouncy: "Bouncy", interactive: "Interactive" },
  play: "Play presets",
  interruption: "Interruption and velocity",
  interruptionHint: "Interrupt reads the state, replaces a slow slide with a spring that inherits its velocity, and reads it again.",
  start: "Start slow slide",
  interrupt: "Interrupt with spring",
  release: "Release at 2400 pt/s",
  stop: "Stop",
  reset: "Reset",
  keyframes: "Keyframes",
  sequence: "Sequence with repeat and reverse",
  stagger: "Stagger",
  timeline: "Timeline: one after another",
  decay: "Decay clamped to the track",
  run: "Run",
  flingBack: "Fling back",
  scrollLink: "Scroll-linked",
  scrollHint: "Scroll the list: the badge fades, scales and turns on the native main thread.",
  link: "Link to scroll",
  unlink: "Unlink",
  readBadge: "Read badge state",
  row: index => `Row ${index}`,
  frames: "JavaScript block",
  framesHint: "The runner loops on the compositor from mount. The button blocks the JavaScript thread for 500 ms while recording 1.5 s of its frames.",
  blockJs: "Block JS for 500 ms",
};

const n = MESSAGES.ar.number;
const ar: MotionMessages = {
  availability: "التوفر",
  presets: "إعدادات النابض المسبقة",
  presetNames: { default: "افتراضي", smooth: "سلس", snappy: "سريع", bouncy: "مرن", interactive: "تفاعلي" },
  play: "تشغيل الإعدادات",
  interruption: "المقاطعة والسرعة",
  interruptionHint: "تقرأ المقاطعة الحالة، وتستبدل الانزلاق البطيء بنابض يرث سرعته، ثم تقرؤها مجددًا.",
  start: "بدء انزلاق بطيء",
  interrupt: "مقاطعة بنابض",
  release: "إفلات بسرعة 2400 نقطة/ث",
  stop: "إيقاف",
  reset: "إعادة تعيين",
  keyframes: "الإطارات المفتاحية",
  sequence: "تسلسل مع تكرار وعكس",
  stagger: "تتابع متدرج",
  timeline: "خط زمني: واحد تلو الآخر",
  decay: "تباطؤ مقيد بالمسار",
  run: "تشغيل",
  flingBack: "قذف للخلف",
  scrollLink: "مرتبط بالتمرير",
  scrollHint: "مرّر القائمة: تتلاشى الشارة وتتغير أبعادها وتدور على الخيط الرئيسي الأصلي.",
  link: "ربط بالتمرير",
  unlink: "إلغاء الربط",
  readBadge: "قراءة حالة الشارة",
  row: index => `الصف ${n(index)}`,
  frames: "حظر JavaScript",
  framesHint: "يتحرك العدّاء على المُركِّب منذ التحميل. يحظر الزر خيط JavaScript لمدة 500 مللي ثانية أثناء تسجيل 1.5 ثانية من إطاراته.",
  blockJs: "حظر JS لمدة 500 مللي ثانية",
};

export const MOTION_MESSAGES: Record<Locale, MotionMessages> = { en, ar };
export function useMotionMessages() { return MOTION_MESSAGES[useI18n().locale]; }
