import { defineScreens } from "../../shell/registry";
import { NitroZxingDemo } from "./NitroZxingDemo";

export default defineScreens("media", [
  { id: "nitro-zxing", title: "Barcode scanning", titles: { ar: "مسح الرموز الشريطية" }, summary: "react-native-nitro-zxing on desktop: ZXing reads a QR code from a still image loaded with Nitro Image.", summaries: { ar: "‏react-native-nitro-zxing على سطح المكتب: تقرأ مكتبة ZXing رمز QR من صورة ثابتة محمّلة عبر Nitro Image." }, component: NitroZxingDemo },
]);
