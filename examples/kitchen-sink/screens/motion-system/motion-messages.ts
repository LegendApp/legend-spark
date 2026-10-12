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
  environment: string;
  environmentHint: string;
  refresh: string;
  reduceMotion: string;
  reduceMotionHint: string;
  slide: string;
  shake: string;
  instant: string;
  hidden: string;
  hiddenHint: string;
  startHidden: string;
  cues: string;
  cuesHint: string;
  playCues: string;
  lifecycle: string;
  lifecycleHint: string;
  startLong: string;
  unmount: string;
  mount: string;
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
  environment: "Motion environment",
  environmentHint: "Reduce Motion, Low Power Mode, the frame rate motion runs at in this window, and whether the window is visible. Updates when the settings change.",
  refresh: "Refresh",
  reduceMotion: "Reduce Motion alternates",
  reduceMotionHint: "With Reduce Motion on, the slide jumps and fades in, the shake becomes a dim pulse, and the instant slide jumps. Off, they play as written.",
  slide: "Slide",
  shake: "Shake",
  instant: "Slide (instant alternate)",
  hidden: "Hidden window",
  hiddenHint: "The spinner repeats forever and pauses while the window is hidden; the 8 s slide jumps to its end instead.",
  startHidden: "Start spinner and slide",
  cues: "Haptic and sound cues",
  cuesHint: "An alignment haptic on the first frame, and a level-change haptic with the Tink sound on the frame the spring settles.",
  playCues: "Play with cues",
  lifecycle: "Unmount cancels",
  lifecycleHint: "Unmounting the view during its 10 s slide stops the animation: it reports finished false.",
  startLong: "Start 10 s slide",
  unmount: "Unmount",
  mount: "Mount",
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
  environment: "بيئة الحركة",
  environmentHint: "تقليل الحركة، ووضع الطاقة المنخفضة، ومعدل الإطارات الذي تعمل به الحركة في هذه النافذة، وما إذا كانت النافذة ظاهرة. يتحدّث عند تغيّر الإعدادات.",
  refresh: "تحديث",
  reduceMotion: "بدائل تقليل الحركة",
  reduceMotionHint: "عند تشغيل تقليل الحركة، يقفز الانزلاق ثم يظهر تدريجيًا، ويصبح الاهتزاز نبضة خافتة، ويقفز الانزلاق الفوري. وعند إيقافه تعمل كما كُتبت.",
  slide: "انزلاق",
  shake: "اهتزاز",
  instant: "انزلاق (بديل فوري)",
  hidden: "نافذة مخفية",
  hiddenHint: "يدور المؤشر بلا توقف ويتوقف مؤقتًا ما دامت النافذة مخفية؛ أما الانزلاق ذو 8 ثوانٍ فيقفز إلى نهايته.",
  startHidden: "بدء المؤشر والانزلاق",
  cues: "إشارات اللمس والصوت",
  cuesHint: "إشارة لمسية للمحاذاة في الإطار الأول، وإشارة لتغيّر المستوى مع صوت Tink في الإطار الذي يستقر فيه النابض.",
  playCues: "تشغيل مع الإشارات",
  lifecycle: "إلغاء التحميل يلغي الحركة",
  lifecycleHint: "إلغاء تحميل العرض أثناء انزلاقه ذي 10 ثوانٍ يوقف الحركة: فتُبلغ بأنها لم تكتمل.",
  startLong: "بدء انزلاق 10 ثوانٍ",
  unmount: "إلغاء التحميل",
  mount: "تحميل",
};

export const MOTION_MESSAGES: Record<Locale, MotionMessages> = { en, ar };
export function useMotionMessages() { return MOTION_MESSAGES[useI18n().locale]; }
