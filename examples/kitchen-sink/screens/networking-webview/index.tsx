import { defineScreens, lazyScreen } from "../../shell/registry";

export default defineScreens("networking-webview", [
  { id: "nitro-fetch", title: "Nitro Fetch", titles: { ar: "جلب Nitro" }, summary: "react-native-nitro-fetch on desktop: a native URLSession request with JSON, headers and status, plus a prefetch served from its cache.", summaries: { ar: "‏react-native-nitro-fetch على سطح المكتب: طلب URLSession أصلي مع JSON والترويسات والحالة، وجلب مسبق يُقدَّم من ذاكرته المؤقتة." }, component: lazyScreen(() => require("./NitroFetchDemo").NitroFetchDemo) },
  { id: "expo-web-browser", title: "Expo Web Browser", titles: { ar: "متصفح Expo" }, summary: "expo-web-browser on desktop: openBrowserAsync opens an in-app web window, and dismissBrowser closes it.", summaries: { ar: "‏expo-web-browser على سطح المكتب: يفتح openBrowserAsync نافذة ويب داخل التطبيق، ويغلقها dismissBrowser." }, component: lazyScreen(() => require("./WebBrowserDemo").WebBrowserDemo) },
  { id: "netinfo", title: "NetInfo", titles: { ar: "معلومات الشبكة" }, summary: "@react-native-community/netinfo on desktop: connection type and reachability from the system network monitor.", summaries: { ar: "‏@react-native-community/netinfo على سطح المكتب: نوع الاتصال وإمكانية الوصول من مراقب شبكة النظام." }, component: lazyScreen(() => require("./NetInfoDemo").NetInfoDemo) },
]);
