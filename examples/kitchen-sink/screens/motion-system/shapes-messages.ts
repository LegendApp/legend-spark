import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Shapes screen. Readouts are JSON from the API, so they are not translated.
type ShapesMessages = {
  title: string;
  morph: string;
  morphHint: string;
  nextShape: string;
  stroke: string;
  strokeHint: string;
  draw: string;
  progress: string;
  read: string;
};

const en: ShapesMessages = {
  title: "Shapes",
  morph: "Morph",
  morphHint: "A MotionShape with three paths: a circle, a star and a square. Next shape springs its morph to the next path and its fill to that shape's color in OKLCH; the engine subdivides the paths to one structure.",
  nextShape: "Next shape",
  stroke: "Stroke drawing",
  strokeHint: "strokeEnd trims the stroke: Draw draws the checkmark on and off, Progress springs the ring to the next quarter. Read reports what the shapes show now.",
  draw: "Draw",
  progress: "Progress",
  read: "Read",
};

const ar: ShapesMessages = {
  title: "الأشكال",
  morph: "التحوّل",
  morphHint: "MotionShape بثلاثة مسارات: دائرة ونجمة ومربع. يحرّك «الشكل التالي» التحوّل بنابض إلى المسار التالي والتعبئة إلى لون ذلك الشكل في OKLCH؛ ويقسّم المحرّك المسارات إلى بنية واحدة.",
  nextShape: "الشكل التالي",
  stroke: "رسم الخط",
  strokeHint: "يقصّ strokeEnd الخط: يرسم «ارسم» علامة الصح ويمحوها، ويحرّك «التقدّم» الحلقة بنابض إلى الربع التالي. ويعرض «اقرأ» ما تُظهره الأشكال الآن.",
  draw: "ارسم",
  progress: "التقدّم",
  read: "اقرأ",
};

export const SHAPES_MESSAGES: Record<Locale, ShapesMessages> = { en, ar };
export function useShapesMessages() { return SHAPES_MESSAGES[useI18n().locale]; }
