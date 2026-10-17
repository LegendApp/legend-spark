import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import type { Scenario } from "./network-demo";

// Strings for DevTools › Network. Availability, entries and results come from the API (JSON, URLs, states), so flows
// can assert them in any locale.
export type NetworkMessages = {
  title: string;
  intro: string;
  sections: { availability: string; requests: string; log: string };
  unavailable: string;
  available: string;
  server: string;
  serverHint: string;
  scenarios: Record<Scenario, string>;
  empty: string;
};

const en: NetworkMessages = {
  title: "Network inspector",
  intro: "In development builds, fetch, XMLHttpRequest and WebSocket traffic of every JavaScript runtime appears in React Native DevTools' Network panel while DevTools is attached, with headers (Authorization and cookies redacted), size-capped bodies, timing, status and initiator. This screen lists the same entries.",
  sections: { availability: "Availability", requests: "Make requests", log: "Recorded requests" },
  unavailable: "The network inspector needs a development build (spark dev). Release builds contain none of it.",
  available: "Recording while this screen or DevTools observes. ⌥⌘I opens DevTools; choose Network.",
  server: "Fixture server",
  serverHint: "Run bun scripts/testing/network-fixtures.ts and paste the http://127.0.0.1:<port>/ address it prints.",
  scenarios: { fetch: "fetch text", xhr: "XMLHttpRequest text", binary: "fetch binary", upload: "POST binary", redirect: "fetch a redirect", stream: "Streamed XMLHttpRequest", abort: "Abort a fetch", large: "fetch 200 KB", websocket: "WebSocket echo", artwork: "Now Playing artwork (native)" },
  empty: "No requests recorded yet.",
};

const ar: NetworkMessages = {
  title: "فاحص الشبكة",
  intro: "في نسخ التطوير تظهر حركة fetch وXMLHttpRequest وWebSocket لكل بيئة تشغيل JavaScript في لوحة Network ضمن أدوات مطوّري React Native أثناء اتصالها، مع الترويسات (تُحجب Authorization وملفات تعريف الارتباط) والأجسام المحدودة الحجم والتوقيت والحالة والمصدر. تعرض هذه الشاشة السجلات نفسها.",
  sections: { availability: "التوفر", requests: "إرسال الطلبات", log: "الطلبات المسجّلة" },
  unavailable: "يحتاج فاحص الشبكة إلى نسخة تطوير (spark dev). لا تحتوي نسخ الإصدار على شيء منه.",
  available: "يسجّل ما دامت هذه الشاشة أو أدوات المطوّر تراقب. يفتح ⌥⌘I أدوات المطوّر؛ اختر Network.",
  server: "خادم التجارب",
  serverHint: "شغّل bun scripts/testing/network-fixtures.ts والصق عنوان http://127.0.0.1:<port>/ الذي يطبعه.",
  scenarios: { fetch: "fetch نص", xhr: "XMLHttpRequest نص", binary: "fetch بيانات ثنائية", upload: "POST بيانات ثنائية", redirect: "fetch مع إعادة توجيه", stream: "XMLHttpRequest متدفق", abort: "إلغاء fetch", large: "fetch بحجم 200 كيلوبايت", websocket: "صدى WebSocket", artwork: "صورة «قيد التشغيل» (وحدة أصلية)" },
  empty: "لا طلبات مسجّلة بعد.",
};

export const NETWORK_MESSAGES: Record<Locale, NetworkMessages> = { en, ar };
export function useNetworkMessages() { return NETWORK_MESSAGES[useI18n().locale]; }
