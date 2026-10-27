import { defineScreens } from "../../shell/registry";
import { BlurDemo } from "./BlurDemo";

export default defineScreens("displays-graphics", [
  { id: "blur", title: "Blur", titles: { ar: "التمويه" }, summary: "@react-native-community/blur on desktop: BlurView and VibrancyView as native NSVisualEffectView materials over a colorful backdrop, in light, dark and adaptive styles.", summaries: { ar: "‏@react-native-community/blur على سطح المكتب: ‏BlurView وVibrancyView كمواد NSVisualEffectView أصلية فوق خلفية ملونة، بأنماط فاتحة وداكنة ومتكيفة." }, component: BlurDemo },
]);
