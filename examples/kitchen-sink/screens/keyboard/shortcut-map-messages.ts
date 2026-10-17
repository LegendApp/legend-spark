import type { ShortcutConflictParty, ShortcutMapScope } from "@legendapp/spark/shortcuts/commands";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import type { DemoCommandId, ExampleId } from "./shortcut-map-demo";

// Strings for the shortcut map screen. Bindings, availability and action results come from the
// API (accelerators, JSON, error codes), so flows can assert them in any locale.
export type ShortcutMapMessages = {
  title: string;
  intro: string;
  loading: string;
  failed(message: string): string;
  sections: { availability: string; commands: string; examples: string; reserved: string; activity: string };
  commands: Record<DemoCommandId, string>;
  scopes: Record<ShortcutMapScope | "menu" | "system", string>;
  unbound: string;
  customized: string;
  record: string;
  unbind: string;
  reset: string;
  resetAll: string;
  conflict(party: string): string;
  party(party: ShortcutConflictParty, title: (id: string) => string): string;
  examples: Record<ExampleId, string>;
  fired(command: string, binding: string, scope: string): string;
  noFired: string;
  result(value: string): string;
  menuTitle: string;
};

const en: ShortcutMapMessages = {
  title: "Shortcut map",
  intro: "Rebinding, unbinding and resets persist in settings and switch live bindings and menu key equivalents in one step.",
  loading: "Loading the shortcut map…",
  failed: message => `Shortcut map failed: ${message}`,
  sections: { availability: "Live dispatch availability", commands: "Commands", examples: "Examples", reserved: "Rejected: reserved by the system", activity: "Activity" },
  commands: { "new-note": "New note", "open-recent": "Open recent", find: "Find", "toggle-sidebar": "Toggle sidebar", bold: "Bold", "clear-console": "Clear console", "quick-capture": "Quick capture" },
  scopes: { application: "App", window: "Window", view: "View", global: "Global", menu: "Menu", system: "System" },
  unbound: "Unbound",
  customized: "Customized",
  record: "Record",
  unbind: "Unbind",
  reset: "Reset",
  resetAll: "Reset all",
  conflict: party => `Conflicts with ${party}`,
  party: (party, title) => party.source === "command" ? `${title(party.commandId)} (${en.scopes[party.scope].toLowerCase()} command)`
    : party.source === "shortcut" ? party.scope === "window" ? `a registered shortcut in window ${party.windowId}` : "a registered app shortcut"
    : party.source === "global-shortcut" ? "a global shortcut"
    : party.source === "menu" ? `menu item ${party.path.join(" › ")}`
    : `a ${party.reserved.platform === "macos" ? "macOS" : "Windows"} system shortcut (${party.reserved.description})`,
  examples: { rebind: "Rebind New note to ⌘⇧N", conflict: "Rebind Find to ⌘S (Document › Save)", reserved: "Rebind Find to ⌘Tab (reserved)" },
  fired: (command, binding, scope) => `Fired ${command} with ${binding} (${scope})`,
  noFired: "Press a binding to fire its command.",
  result: value => `Last change: ${value}`,
  menuTitle: "Shortcut Map",
};

const ar: ShortcutMapMessages = {
  title: "خريطة الاختصارات",
  intro: "تُحفظ إعادة التعيين والإلغاء والاستعادة في الإعدادات وتبدّل الاختصارات الحية ومفاتيح القوائم في خطوة واحدة.",
  loading: "جارٍ تحميل خريطة الاختصارات…",
  failed: message => `تعذّر تحميل خريطة الاختصارات: ${message}`,
  sections: { availability: "توفر الإرسال الحي", commands: "الأوامر", examples: "أمثلة", reserved: "مرفوضة: محجوزة للنظام", activity: "النشاط" },
  commands: { "new-note": "ملاحظة جديدة", "open-recent": "فتح الأخير", find: "بحث", "toggle-sidebar": "إظهار الشريط الجانبي", bold: "غامق", "clear-console": "مسح وحدة التحكم", "quick-capture": "التقاط سريع" },
  scopes: { application: "التطبيق", window: "النافذة", view: "العرض", global: "عام", menu: "القائمة", system: "النظام" },
  unbound: "بلا اختصار",
  customized: "مخصص",
  record: "تسجيل",
  unbind: "إلغاء",
  reset: "استعادة",
  resetAll: "استعادة الكل",
  conflict: party => `يتعارض مع ${party}`,
  party: (party, title) => party.source === "command" ? `${title(party.commandId)} (أمر ${ar.scopes[party.scope]})`
    : party.source === "shortcut" ? party.scope === "window" ? `اختصار مسجّل في النافذة ${party.windowId}` : "اختصار مسجّل للتطبيق"
    : party.source === "global-shortcut" ? "اختصار عام"
    : party.source === "menu" ? `عنصر القائمة ${party.path.join(" › ")}`
    : `اختصار محجوز للنظام ${party.reserved.platform === "macos" ? "macOS" : "Windows"}`,
  examples: { rebind: "تعيين ⌘⇧N لملاحظة جديدة", conflict: "تعيين ⌘S للبحث (مستند › حفظ)", reserved: "تعيين ⌘Tab للبحث (محجوز)" },
  fired: (command, binding, scope) => `نُفّذ ${command} بالاختصار ${binding} (${scope})`,
  noFired: "اضغط اختصارًا لتنفيذ أمره.",
  result: value => `آخر تغيير: ${value}`,
  menuTitle: "خريطة الاختصارات",
};

export const SHORTCUT_MAP_MESSAGES: Record<Locale, ShortcutMapMessages> = { en, ar };
export function useShortcutMapMessages() { return SHORTCUT_MAP_MESSAGES[useI18n().locale]; }
