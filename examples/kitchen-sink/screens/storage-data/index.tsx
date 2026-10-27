import { defineScreens } from "../../shell/registry";
import { MMKVDemo } from "./MMKVDemo";

export default defineScreens("storage-data", [
  { id: "mmkv", title: "MMKV", titles: { ar: "تخزين MMKV" }, summary: "react-native-mmkv on desktop: typed values, buffers, change listeners, and storage that persists across launches in the app's own data folder.", summaries: { ar: "‏react-native-mmkv على سطح المكتب: قيم بأنواعها، ومخازن بايتات، ومستمعو التغيير، وتخزين يبقى بين مرات التشغيل في مجلد بيانات التطبيق نفسه." }, component: MMKVDemo },
]);
