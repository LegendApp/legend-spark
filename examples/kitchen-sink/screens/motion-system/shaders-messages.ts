import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Shaders and particles screen. Readouts are JSON from the API, so they are not translated.
type ShadersMessages = {
  title: string;
  summary: string;
  effects: string;
  effectsHint: string;
  ripple: string;
  dissolve: string;
  bulge: string;
  sweep: string;
  particles: string;
  particlesHint: string;
  start: string;
  burst: string;
  stop: string;
};

const en: ShadersMessages = {
  title: "Shaders and particles",
  summary: "Built-in ripple, dissolve, distortion and specular-sweep effects driven by motion properties, and particles started and stopped from JavaScript; Reduce Motion followed.",
  effects: "Shader effects",
  effectsHint: "Each card is a MotionShader. Ripple and Bulge are Core Image filters and Sweep a gradient layer, all played by the compositor; Dissolve is a precompiled Metal mask rendered on display frames. Under Reduce Motion the ripple, bulge and sweep change at once.",
  ripple: "Ripple",
  dissolve: "Dissolve",
  bulge: "Bulge",
  sweep: "Sweep",
  particles: "Particles",
  particlesHint: "The panel is a MotionEmitter: Start emits until Stop, Burst for 600 ms. Under Reduce Motion nothing is emitted.",
  start: "Start",
  burst: "Burst",
  stop: "Stop",
};

const ar: ShadersMessages = {
  title: "المُظلِّلات والجسيمات",
  summary: "تأثيرات مدمجة للتموّج والتلاشي والتشويه ولمعة الضوء تحرّكها خصائص الحركة، وجسيمات تبدأ وتتوقف من JavaScript، مع مراعاة «تقليل الحركة».",
  effects: "تأثيرات المُظلِّل",
  effectsHint: "كل بطاقة هي MotionShader. «تموّج» و«انتفاخ» مرشّحا Core Image و«لمعة» طبقة تدرّج، ويشغّلها جميعًا المُركِّب؛ أما «تلاشٍ» فقناع Metal مُترجَم مسبقًا يُرسَم مع إطارات العرض. مع «تقليل الحركة» يتغيّر التموّج والانتفاخ واللمعة دفعة واحدة.",
  ripple: "تموّج",
  dissolve: "تلاشٍ",
  bulge: "انتفاخ",
  sweep: "لمعة",
  particles: "الجسيمات",
  particlesHint: "اللوحة هي MotionEmitter: «ابدأ» يُطلق الجسيمات حتى «أوقف»، و«دفعة» لمدة 600 ملّي ثانية. مع «تقليل الحركة» لا يُطلَق شيء.",
  start: "ابدأ",
  burst: "دفعة",
  stop: "أوقف",
};

export const SHADERS_MESSAGES: Record<Locale, ShadersMessages> = { en, ar };
export function useShadersMessages() { return SHADERS_MESSAGES[useI18n().locale]; }
