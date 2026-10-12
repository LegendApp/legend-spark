import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Speech screen. The phrase, statuses, results and transcripts are API data, so flows can assert them in
// any locale; they are not translated.
export type SpeechMessages = {
  title: string; intro: string; availability: string; synthesis: string; recognition: string; events: string;
  speak: string; speakFast: string; pause: string; resume: string; stop: string;
  request: string; listen: string; listenOnDevice: string; finish: string; cancel: string;
  reading: string; notSpoken: string; noWord: string; noPartial: string; noOutcome: string; noEvents: string; driver: string;
};

const en: SpeechMessages = {
  title: "Speech",
  intro: "Text to speech and speech recognition as macOS provides them. Opening this screen only reads voices and states; nothing speaks or listens until you press a button. Recognition needs the speech recognition and microphone permissions, and never asks for them itself.",
  availability: "Availability", synthesis: "Text to speech", recognition: "Speech recognition", events: "Utterance events",
  speak: "Speak", speakFast: "Speak fast, high, quiet", pause: "Pause after word", resume: "Resume", stop: "Stop",
  request: "Request permissions", listen: "Listen", listenOnDevice: "Listen on device", finish: "Stop listening", cancel: "Cancel",
  reading: "Reading…", notSpoken: "Nothing spoken yet.", noWord: "No word yet.", noPartial: "No partial transcript yet.", noOutcome: "No recognition yet.", noEvents: "None yet.",
  driver: "In a test-driver run speech is simulated: utterances are recorded, never spoken, and recognition plays back a scripted transcript without the microphone.",
};

const ar: SpeechMessages = {
  title: "الكلام",
  intro: "تحويل النص إلى كلام والتعرف على الكلام كما يوفرهما macOS. فتح هذه الشاشة يقرأ الأصوات والحالات فقط؛ لا شيء يُنطق أو يُسمع حتى تضغط زرًا. يحتاج التعرف إلى إذني التعرف على الكلام والميكروفون، ولا يطلبهما بنفسه أبدًا.",
  availability: "التوفر", synthesis: "تحويل النص إلى كلام", recognition: "التعرف على الكلام", events: "أحداث النطق",
  speak: "انطق", speakFast: "سريع وعالٍ وهادئ", pause: "إيقاف بعد الكلمة", resume: "متابعة", stop: "إيقاف",
  request: "طلب الأذونات", listen: "استمع", listenOnDevice: "استمع على الجهاز", finish: "إنهاء الاستماع", cancel: "إلغاء",
  reading: "جارٍ القراءة…", notSpoken: "لم يُنطق شيء بعد.", noWord: "لا كلمة بعد.", noPartial: "لا نص جزئي بعد.", noOutcome: "لا نتيجة تعرّف بعد.", noEvents: "لا شيء بعد.",
  driver: "في تشغيل برنامج الاختبار يكون الكلام محاكاة: تُسجَّل العبارات ولا تُنطق، ويعيد التعرف نصًا معدًّا مسبقًا دون الميكروفون.",
};

export const SPEECH_MESSAGES: Record<Locale, SpeechMessages> = { en, ar };
export function useSpeechMessages() { return SPEECH_MESSAGES[useI18n().locale]; }
