import { defineScreens } from "../../shell/registry";
import { BlurDemo } from "./BlurDemo";
import { FastImageDemo } from "./FastImageDemo";
import { SkiaDemo } from "./SkiaDemo";
import { BlurhashDemo } from "./BlurhashDemo";
import { ScreenCornerRadiusDemo } from "./ScreenCornerRadiusDemo";

export default defineScreens("displays-graphics", [
  { id: "blur", title: "Blur", titles: { ar: "التمويه" }, summary: "@react-native-community/blur on desktop: BlurView and VibrancyView as native NSVisualEffectView materials over a colorful backdrop, in light, dark and adaptive styles.", summaries: { ar: "‏@react-native-community/blur على سطح المكتب: ‏BlurView وVibrancyView كمواد NSVisualEffectView أصلية فوق خلفية ملونة، بأنماط فاتحة وداكنة ومتكيفة." }, component: BlurDemo },
  { id: "fast-image", title: "FastImage", titles: { ar: "صور FastImage" }, summary: "react-native-fast-image on desktop: React Native's Image stands in for its UIKit view, with load events, objectFit, tint, preload and reload.", summaries: { ar: "‏react-native-fast-image على سطح المكتب: يحل Image من React Native محل عرض UIKit الخاص بها، مع أحداث التحميل وobjectFit والتلوين والتحميل المسبق وإعادة التحميل." }, component: FastImageDemo },
  { id: "skia", title: "Skia", titles: { ar: "رسومات Skia" }, summary: "@shopify/react-native-skia on desktop: a declarative Canvas drawn by Skia's Metal backend, read back pixel by pixel, and an offscreen raster surface.", summaries: { ar: "‏@shopify/react-native-skia على سطح المكتب: ‏Canvas تصريحية ترسمها واجهة Metal في Skia وتُقرأ بكسلًا بكسلًا، وسطح نقطي خارج الشاشة." }, component: SkiaDemo },
  { id: "blurhash", title: "Blurhash", titles: { ar: "صور Blurhash" }, summary: "react-native-blurhash on desktop: a native AppKit view decoding a Blurhash placeholder, and encoding a local image to a Blurhash string.", summaries: { ar: "‏react-native-blurhash على سطح المكتب: عرض AppKit أصلي يفك ترميز صورة Blurhash مؤقتة، وترميز صورة محلية إلى نص Blurhash." }, component: BlurhashDemo },
  { id: "screen-corner-radius", title: "Screen corner radius", titles: { ar: "نصف قطر زوايا الشاشة" }, summary: "react-native-screen-corner-radius on desktop: it imports without its iOS-only native module and reports square corners.", summaries: { ar: "‏react-native-screen-corner-radius على سطح المكتب: يُستورد دون وحدته الأصلية الخاصة بـ iOS ويُبلغ عن زوايا مربعة." }, component: ScreenCornerRadiusDemo },
]);
