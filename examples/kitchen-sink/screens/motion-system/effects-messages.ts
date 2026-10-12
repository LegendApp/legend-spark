import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Visual effects screen. Readouts are JSON from the API, so they are not translated.
type EffectsMessages = {
  colors: string;
  colorsHint: string;
  toggleColor: string;
  readColor: string;
  surface: string;
  surfaceHint: string;
  lift: string;
  blur: string;
  depth: string;
  depthHint: string;
  flip: string;
  tilt: string;
  mask: string;
  maskHint: string;
  wipe: string;
  iris: string;
  revealed: string;
  path: string;
  pathHint: string;
  travel: string;
};

const en: EffectsMessages = {
  colors: "Colors in OKLCH",
  colorsHint: "The swatch animates between blue and yellow in OKLCH: halfway it is a saturated green where an sRGB blend would be gray. The readout is the color it settles at.",
  toggleColor: "Blue ⇄ yellow",
  readColor: "Read color",
  surface: "Corners, shadow and blur",
  surfaceHint: "Lift springs the corner radius, the shadow and the scale together; Blur animates a Gaussian blur on the card's layer.",
  lift: "Lift",
  blur: "Blur",
  depth: "3D and perspective",
  depthHint: "The card turns about its vertical axis (Flip) or leans back about its horizontal one (Tilt), seen in perspective from 500 points.",
  flip: "Flip",
  tilt: "Tilt",
  mask: "Mask reveal",
  maskHint: "Wipe uncovers the content from its leading edge (the trailing mask inset shrinks); Iris opens a circle from the centre.",
  wipe: "Wipe",
  iris: "Iris",
  revealed: "Revealed content",
  path: "Along a path",
  pathHint: "Travel moves the arrow along an S-curve from an SVG path, turned to the path's heading: keyframes the engine plays on the compositor.",
  travel: "Travel",
};

const ar: EffectsMessages = {
  colors: "الألوان في OKLCH",
  colorsHint: "تتحرك العيّنة بين الأزرق والأصفر في OKLCH: في منتصف الطريق تكون أخضر مشبعًا بينما يكون مزج sRGB رماديًا. تعرض القراءة اللون الذي تستقر عليه.",
  toggleColor: "أزرق ⇄ أصفر",
  readColor: "قراءة اللون",
  surface: "الزوايا والظل والتمويه",
  surfaceHint: "يحرّك «رفع» نصف قطر الزوايا والظل والحجم معًا بنابض؛ ويحرّك «تمويه» تمويهًا غاوسيًا على طبقة البطاقة.",
  lift: "رفع",
  blur: "تمويه",
  depth: "ثلاثي الأبعاد والمنظور",
  depthHint: "تدور البطاقة حول محورها الرأسي (قلب) أو تميل إلى الخلف حول محورها الأفقي (إمالة)، ويُرى ذلك بمنظور من مسافة 500 نقطة.",
  flip: "قلب",
  tilt: "إمالة",
  mask: "الكشف بالقناع",
  maskHint: "يكشف «مسح» المحتوى من حافته الأمامية (يتقلص هامش القناع الخلفي)؛ ويفتح «قزحية» دائرة من المركز.",
  wipe: "مسح",
  iris: "قزحية",
  revealed: "محتوى مكشوف",
  path: "على طول مسار",
  pathHint: "يحرّك «انتقال» السهم على طول منحنى على شكل S من مسار SVG، متّجهًا باتجاه المسار: إطارات مفتاحية يشغّلها المحرك على المُركِّب.",
  travel: "انتقال",
};

export const EFFECTS_MESSAGES: Record<Locale, EffectsMessages> = { en, ar };
export function useEffectsMessages() { return EFFECTS_MESSAGES[useI18n().locale]; }
