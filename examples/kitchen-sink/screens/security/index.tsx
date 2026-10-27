import { defineScreens } from "../../shell/registry";
import { QuickCryptoDemo } from "./QuickCryptoDemo";

export default defineScreens("security", [
  { id: "quick-crypto", title: "Quick Crypto", titles: { ar: "التشفير السريع" }, summary: "react-native-quick-crypto on desktop: hashes, HMAC, PBKDF2, AES-GCM, random bytes and WebCrypto digest against known vectors.", summaries: { ar: "‏react-native-quick-crypto على سطح المكتب: التجزئة وHMAC وPBKDF2 وAES-GCM والبايتات العشوائية وملخص WebCrypto مقارنةً بقيم معروفة." }, component: QuickCryptoDemo },
]);
