import { defineScreens } from "../../shell/registry";
import { MMKVDemo } from "./MMKVDemo";
import { NitroSQLiteDemo } from "./NitroSQLiteDemo";

export default defineScreens("storage-data", [
  { id: "mmkv", title: "MMKV", titles: { ar: "تخزين MMKV" }, summary: "react-native-mmkv on desktop: typed values, buffers, change listeners, and storage that persists across launches in the app's own data folder.", summaries: { ar: "‏react-native-mmkv على سطح المكتب: قيم بأنواعها، ومخازن بايتات، ومستمعو التغيير، وتخزين يبقى بين مرات التشغيل في مجلد بيانات التطبيق نفسه." }, component: MMKVDemo },
  { id: "nitro-sqlite", title: "Nitro SQLite", titles: { ar: "قاعدة Nitro SQLite" }, summary: "react-native-nitro-sqlite on desktop: parameterized queries, a transaction and async execution against a database in the app's Application Support folder.", summaries: { ar: "‏react-native-nitro-sqlite على سطح المكتب: استعلامات بمعاملات ومعاملة وتنفيذ غير متزامن على قاعدة بيانات في مجلد Application Support الخاص بالتطبيق." }, component: NitroSQLiteDemo },
]);
