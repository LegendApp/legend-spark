import { defineScreens } from "../../shell/registry";
import { VisualEffects } from "./EffectsScreen";
import { Layout } from "./LayoutScreen";
import { MATERIALS_MESSAGES } from "./materials-messages";
import { Materials } from "./MaterialsScreen";
import { AccessibilityPower, ScrollAndFrames, Springs, Timelines } from "./MotionScreens";
import { SHAPES_MESSAGES } from "./shapes-messages";
import { Shapes } from "./ShapesScreen";
import { SHADERS_MESSAGES } from "./shaders-messages";
import { Shaders } from "./ShadersScreen";
import { TextAndSymbols } from "./TextSymbolsScreen";

export default defineScreens("motion-system", [
  { id: "springs", title: "Springs and interruption", titles: { ar: "النوابض والمقاطعة" }, summary: "Platform spring presets, interruption that keeps velocity, and a gesture release velocity hand-off.", summaries: { ar: "إعدادات النابض المسبقة في المنصة، ومقاطعة تحافظ على السرعة، وتسليم سرعة الإفلات من الإيماءة." }, component: Springs },
  { id: "timelines", title: "Keyframes and timelines", titles: { ar: "الإطارات المفتاحية والخطوط الزمنية" }, summary: "Keyframes, a repeating reversed sequence, a stagger, a timeline step after the previous one, and clamped decay.", summaries: { ar: "إطارات مفتاحية، وتسلسل يتكرر معكوسًا، وتتابع متدرج، وخطوة في خط زمني تبدأ بعد سابقتها، وتباطؤ مقيد." }, component: Timelines },
  { id: "scroll-and-frames", title: "Scroll link and JS block", titles: { ar: "الربط بالتمرير وحظر JS" }, summary: "A scroll-linked badge driven on the native main thread, and frames recorded while JavaScript is blocked for 500 ms.", summaries: { ar: "شارة مرتبطة بالتمرير تتحرك على الخيط الرئيسي الأصلي، وإطارات تُسجَّل أثناء حظر JavaScript لمدة 500 مللي ثانية." }, component: ScrollAndFrames },
  { id: "layout", title: "Layout, presence and shared elements", titles: { ar: "التخطيط والظهور والعناصر المشتركة" }, summary: "Rows that enter, exit and reflow with layout animation, a frame that scales to its new size, and a shared element between a thumbnail and its detail.", summaries: { ar: "صفوف تدخل وتخرج ويُعاد تدفقها بحركة التخطيط، وإطار يتحجّم إلى حجمه الجديد، وعنصر مشترك بين صورة مصغّرة وتفاصيلها." }, component: Layout },
  { id: "visual-effects", title: "Visual effects", titles: { ar: "التأثيرات المرئية" }, summary: "Background colors that animate in OKLCH, corner radius, shadow and blur, 3D rotation in perspective, mask reveals and a path, all on the compositor.", summaries: { ar: "ألوان خلفية تتحرك في OKLCH، ونصف قطر الزوايا والظل والتمويه، ودوران ثلاثي الأبعاد بمنظور، وكشف بالقناع، ومسار، وكلها على المُركِّب." }, component: VisualEffects },
  { id: "materials", title: MATERIALS_MESSAGES.en.title, titles: { ar: MATERIALS_MESSAGES.ar.title }, summary: "A backdrop material that crossfades between materials and to Liquid Glass, with its intensity and tint animated on the compositor; Reduce Motion and Reduce Transparency followed.", summaries: { ar: "مادة خلفية تنتقل بتلاشٍ متبادل بين المواد وإلى Liquid Glass، مع تحريك شدتها وتلوينها على المُركِّب؛ وتتبع تقليل الحركة وتقليل الشفافية." }, component: Materials },
  { id: "shapes", title: SHAPES_MESSAGES.en.title, titles: { ar: SHAPES_MESSAGES.ar.title }, summary: "A shape that morphs between a circle, a star and a square with a spring, a checkmark drawn with its stroke, and a progress ring, all on the compositor.", summaries: { ar: "شكل يتحوّل بنابض بين دائرة ونجمة ومربع، وعلامة صح تُرسم بخطها، وحلقة تقدم، وكلها على المُركِّب." }, component: Shapes },
  { id: "shaders", title: SHADERS_MESSAGES.en.title, titles: { ar: SHADERS_MESSAGES.ar.title }, summary: SHADERS_MESSAGES.en.summary, summaries: { ar: SHADERS_MESSAGES.ar.summary }, component: Shaders },
  { id: "text-and-symbols", title: "Text and symbols", titles: { ar: "النصوص والرموز" }, summary: "Rolling digits, per-character crossfade and typewriter text, and SF Symbol effects with a replace transition.", summaries: { ar: "أرقام متدحرجة، وتلاشٍ متبادل لكل حرف، ونص بأسلوب الآلة الكاتبة، وتأثيرات رموز SF مع انتقال الاستبدال." }, component: TextAndSymbols },
  { id: "accessibility-power", title: "Accessibility, power and lifecycle", titles: { ar: "إمكانية الوصول والطاقة ودورة الحياة" }, summary: "Reduce Motion alternates, the frame rate for the display and Low Power Mode, pausing in a hidden window, cancelling on unmount, and haptic and sound cues on frames.", summaries: { ar: "بدائل تقليل الحركة، ومعدل الإطارات بحسب الشاشة ووضع الطاقة المنخفضة، والإيقاف المؤقت في نافذة مخفية، والإلغاء عند إلغاء التحميل، وإشارات اللمس والصوت على الإطارات." }, component: AccessibilityPower },
]);
