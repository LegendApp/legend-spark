import { defineScreens } from "../../shell/registry";
import { BlurDemo } from "./BlurDemo";
import { FastImageDemo } from "./FastImageDemo";

export default defineScreens("displays-graphics", [
  { id: "blur", title: "Blur", titles: { ar: "التمويه" }, summary: "@react-native-community/blur on desktop: BlurView and VibrancyView as native NSVisualEffectView materials over a colorful backdrop, in light, dark and adaptive styles.", summaries: { ar: "‏@react-native-community/blur على سطح المكتب: ‏BlurView وVibrancyView كمواد NSVisualEffectView أصلية فوق خلفية ملونة، بأنماط فاتحة وداكنة ومتكيفة." }, component: BlurDemo },
  { id: "fast-image", title: "FastImage", titles: { ar: "صور FastImage" }, summary: "react-native-fast-image on desktop: React Native's Image stands in for its UIKit view, with load events, objectFit, tint, preload and reload.", summaries: { ar: "‏react-native-fast-image على سطح المكتب: يحل Image من React Native محل عرض UIKit الخاص بها، مع أحداث التحميل وobjectFit والتلوين والتحميل المسبق وإعادة التحميل." }, component: FastImageDemo },
]);
