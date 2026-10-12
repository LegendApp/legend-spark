import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import type { VideoAction } from "./video-demo";

// Strings for the Video screen. Status, events, results and availability are API data, so flows can assert them in any
// locale; they are not translated.
export type VideoMessages = {
  title: string; intro: string; availability: string; playback: string; window: string; events: string;
  loading: string; noEvents: string; noResult: string; driver: string; videoLabel: string;
  actions: Record<VideoAction, string>;
};

const en: VideoMessages = {
  title: "Video",
  intro: "A three-second test clip with no sound, played by AVFoundation. Opening this screen loads it paused; the buttons command the player, and the status and events come back from it.",
  availability: "Availability", playback: "Playback", window: "Fullscreen and picture in picture", events: "Events",
  loading: "Loading…", noEvents: "None yet.", noResult: "No result yet.",
  driver: "In a test-driver run fullscreen and picture in picture only change the status: no window opens.",
  videoLabel: "Test video",
  actions: {
    play: "Play", pause: "Pause", seek: "Seek to 1.5 s", nearEnd: "Seek to 2.5 s", rate: "Rate 1× / 2×", volume: "Volume 1 / 0.5", mute: "Mute",
    enterFullscreen: "Fullscreen", exitFullscreen: "Exit fullscreen", startPip: "Picture in picture", stopPip: "Stop picture in picture",
  },
};

const ar: VideoMessages = {
  title: "الفيديو",
  intro: "مقطع اختبار مدته ثلاث ثوانٍ بلا صوت يشغّله AVFoundation. فتح هذه الشاشة يحمّله متوقفًا؛ الأزرار توجّه المشغّل، وتعود منه الحالة والأحداث.",
  availability: "التوفر", playback: "التشغيل", window: "ملء الشاشة وصورة داخل صورة", events: "الأحداث",
  loading: "جارٍ التحميل…", noEvents: "لا شيء بعد.", noResult: "لا نتيجة بعد.",
  driver: "في تشغيل برنامج الاختبار يغيّر ملء الشاشة وصورة داخل صورة الحالة فقط: لا تُفتح أي نافذة.",
  videoLabel: "فيديو الاختبار",
  actions: {
    play: "تشغيل", pause: "إيقاف مؤقت", seek: "انتقال إلى 1.5 ث", nearEnd: "انتقال إلى 2.5 ث", rate: "السرعة 1× / 2×", volume: "الصوت 1 / 0.5", mute: "كتم",
    enterFullscreen: "ملء الشاشة", exitFullscreen: "إنهاء ملء الشاشة", startPip: "صورة داخل صورة", stopPip: "إيقاف صورة داخل صورة",
  },
};

export const VIDEO_MESSAGES: Record<Locale, VideoMessages> = { en, ar };
export function useVideoMessages() { return VIDEO_MESSAGES[useI18n().locale]; }
