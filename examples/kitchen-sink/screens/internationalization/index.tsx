import { defineScreens } from "../../shell/registry";
import { NativeStrings } from "./NativeStrings";
import { NATIVE_STRINGS_MESSAGES } from "./native-strings-messages";
import { ScrollDirection } from "./ScrollDirection";
import { TextAlignment } from "./TextAlignment";

export default defineScreens("internationalization", [
  { id: "native-strings", title: "Native strings", titles: { ar: NATIVE_STRINGS_MESSAGES.ar.title }, summary: "The app's languages and per-app language: menus, dialog buttons and AppKit panels use the current one, including Spark's own strings.", summaries: { ar: "لغات التطبيق ولغته الخاصة: تستخدم القوائم وأزرار مربعات الحوار ولوحات AppKit اللغة الحالية، بما في ذلك نصوص Spark نفسها." }, component: NativeStrings },
  { id: "scroll-direction", title: "Scroll direction", titles: { ar: "اتجاه التمرير" }, summary: "A horizontal ScrollView: it starts at the leading edge, and its content reads correctly in right-to-left locales.", summaries: { ar: "عرض ScrollView أفقي يبدأ من الحافة الأمامية، ويُقرأ محتواه صحيحًا في اللغات التي تُكتب من اليمين إلى اليسار." }, component: ScrollDirection },
  { id: "text-alignment", title: "Text alignment", titles: { ar: "محاذاة النص" }, summary: "Text in full-width boxes with each textAlign: the default and auto start at the leading edge in right-to-left locales.", summaries: { ar: "نص في مربعات بعرض كامل بكل قيمة لـ textAlign: تبدأ القيمة الافتراضية وauto من الحافة الأمامية في اللغات التي تُكتب من اليمين إلى اليسار." }, component: TextAlignment },
]);
