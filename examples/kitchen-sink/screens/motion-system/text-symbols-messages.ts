import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Text and symbols screen. Readouts are JSON from the API, so they are not translated.
type TextSymbolsMessages = {
  digits: string;
  digitsHint: string;
  addOne: string;
  addHundred: string;
  text: string;
  textHint: string;
  words: readonly [string, string];
  swap: string;
  phrases: readonly [string, string];
  type: string;
  symbols: string;
  symbolsHint: string;
  effects: Record<"bounce" | "pulse" | "wiggle" | "rotate" | "breathe" | "drawOff" | "drawOn", string>;
  replace: string;
  stop: string;
};

const en: TextSymbolsMessages = {
  digits: "Rolling digits",
  digitsHint: "Each changed digit of the formatted number rolls to its new value; a digit that does not change stays still.",
  addOne: "+1",
  addHundred: "+100",
  text: "Text transitions",
  textHint: "The status crossfades each changed character in its place; the typewriter types the new text one character after another.",
  words: ["Draft", "Saved"],
  swap: "Swap status",
  phrases: ["Hello there", "Motion types this line"],
  type: "Type",
  symbols: "Symbol effects",
  symbolsHint: "SF Symbol effects on the bell, each available from the macOS version that introduced it. Replace swaps the bell for its slashed variant with a down-up transition.",
  effects: { bounce: "Bounce", pulse: "Pulse", wiggle: "Wiggle", rotate: "Rotate", breathe: "Breathe", drawOff: "Draw off", drawOn: "Draw on" },
  replace: "Replace",
  stop: "Stop effects",
};

const ar: TextSymbolsMessages = {
  digits: "أرقام متدحرجة",
  digitsHint: "يتدحرج كل رقم متغيّر من العدد المنسّق إلى قيمته الجديدة؛ ويبقى الرقم الذي لا يتغيّر ثابتًا.",
  addOne: "+1",
  addHundred: "+100",
  text: "انتقالات النص",
  textHint: "تتلاشى الحالة حرفًا حرفًا في مكان كل حرف متغيّر؛ وتكتب الآلة الكاتبة النص الجديد حرفًا بعد حرف.",
  words: ["مسودة", "محفوظ"],
  swap: "تبديل الحالة",
  phrases: ["مرحبًا بك", "الحركة تكتب هذا السطر"],
  type: "اكتب",
  symbols: "تأثيرات الرموز",
  symbolsHint: "تأثيرات رموز SF على الجرس، كل منها متاح بدءًا من إصدار macOS الذي قدّمه. يستبدل «استبدال» الجرس بنسخته المشطوبة بانتقال من الأسفل إلى الأعلى.",
  effects: { bounce: "ارتداد", pulse: "نبض", wiggle: "اهتزاز", rotate: "دوران", breathe: "تنفّس", drawOff: "محو الرسم", drawOn: "رسم" },
  replace: "استبدال",
  stop: "إيقاف التأثيرات",
};

export const TEXT_SYMBOLS_MESSAGES: Record<Locale, TextSymbolsMessages> = { en, ar };
export function useTextSymbolsMessages() { return TEXT_SYMBOLS_MESSAGES[useI18n().locale]; }
