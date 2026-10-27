import { defineScreens } from "../../shell/registry";
import { QuickCryptoDemo } from "./QuickCryptoDemo";
import { TrackingTransparencyDemo } from "./TrackingTransparencyDemo";

export default defineScreens("security", [
  { id: "quick-crypto", title: "Quick Crypto", titles: { ar: "التشفير السريع" }, summary: "react-native-quick-crypto on desktop: hashes, HMAC, PBKDF2, AES-GCM, random bytes and WebCrypto digest against known vectors.", summaries: { ar: "‏react-native-quick-crypto على سطح المكتب: التجزئة وHMAC وPBKDF2 وAES-GCM والبايتات العشوائية وملخص WebCrypto مقارنةً بقيم معروفة." }, component: QuickCryptoDemo },
  { id: "tracking-transparency", title: "Tracking transparency", titles: { ar: "شفافية التتبع" }, summary: "react-native-tracking-transparency on desktop: App Tracking Transparency status from AppKit's ATTrackingManager, and a button to request permission.", summaries: { ar: "‏react-native-tracking-transparency على سطح المكتب: حالة شفافية تتبع التطبيق من ATTrackingManager، وزر لطلب الإذن." }, component: TrackingTransparencyDemo },
]);
