import { defineScreens, lazyScreen } from "../../shell/registry";

export default defineScreens("media", [
  { id: "nitro-zxing", title: "Barcode scanning", titles: { ar: "مسح الرموز الشريطية" }, summary: "react-native-nitro-zxing on desktop: ZXing reads a QR code from a still image loaded with Nitro Image.", summaries: { ar: "‏react-native-nitro-zxing على سطح المكتب: تقرأ مكتبة ZXing رمز QR من صورة ثابتة محمّلة عبر Nitro Image." }, component: lazyScreen(() => require("./NitroZxingDemo").NitroZxingDemo) },
  { id: "image-picker", title: "Image picker", titles: { ar: "منتقي الصور" }, summary: "expo-image-picker on desktop: picking image and movie files with an open panel; the camera picker reports unavailable.", summaries: { ar: "‏expo-image-picker على سطح المكتب: اختيار ملفات الصور والأفلام عبر لوحة فتح؛ ومنتقي الكاميرا يُبلغ بعدم توفره." }, component: lazyScreen(() => require("./ImagePickerDemo").ImagePickerDemo) },
  { id: "image-manipulator", title: "Image manipulator", titles: { ar: "معالج الصور" }, summary: "expo-image-manipulator on desktop: rotating, flipping, resizing and cropping an image, checked pixel by pixel.", summaries: { ar: "‏expo-image-manipulator على سطح المكتب: تدوير صورة وقلبها وتغيير حجمها واقتصاصها، مع التحقق بكسلًا بكسلًا." }, component: lazyScreen(() => require("./ImageManipulatorDemo").ImageManipulatorDemo) },
]);
