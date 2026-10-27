import { defineScreens, lazyScreen } from "../../shell/registry";

export default defineScreens("networking-webview", [
  { id: "nitro-fetch", title: "Nitro Fetch", titles: { ar: "جلب Nitro" }, summary: "react-native-nitro-fetch on desktop: a native URLSession request with JSON, headers and status, plus a prefetch served from its cache.", summaries: { ar: "‏react-native-nitro-fetch على سطح المكتب: طلب URLSession أصلي مع JSON والترويسات والحالة، وجلب مسبق يُقدَّم من ذاكرته المؤقتة." }, component: lazyScreen(() => require("./NitroFetchDemo").NitroFetchDemo) },
]);
