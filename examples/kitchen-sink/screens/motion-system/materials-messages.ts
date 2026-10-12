import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Backdrop materials screen. Readouts are JSON from the API, so they are not translated.
type MaterialsMessages = {
  title: string;
  backdrop: string;
  backdropHint: string;
  next: string;
  glass: string;
  fade: string;
  tint: string;
};

const en: MaterialsMessages = {
  title: "Backdrop materials",
  backdrop: "Crossfade, intensity and tint",
  backdropHint: "The panel is a MotionMaterial over the stripes, blending within the window. Next crossfades to another material, Glass to Liquid Glass where this Mac has it; Fade animates the material's intensity and Tint its tint, both on the compositor.",
  next: "Next material",
  glass: "Glass",
  fade: "Fade",
  tint: "Tint",
};

const ar: MaterialsMessages = {
  title: "المواد الخلفية",
  backdrop: "التلاشي المتبادل والشدة والتلوين",
  backdropHint: "اللوحة هي MotionMaterial فوق الخطوط، تمتزج داخل النافذة. ينتقل «المادة التالية» بتلاشٍ متبادل إلى مادة أخرى، و«زجاج» إلى Liquid Glass إن توفّر على هذا الـMac؛ ويحرّك «تلاشٍ» شدة المادة و«تلوين» لونها، وكلاهما على المُركِّب.",
  next: "المادة التالية",
  glass: "زجاج",
  fade: "تلاشٍ",
  tint: "تلوين",
};

export const MATERIALS_MESSAGES: Record<Locale, MaterialsMessages> = { en, ar };
export function useMaterialsMessages() { return MATERIALS_MESSAGES[useI18n().locale]; }
