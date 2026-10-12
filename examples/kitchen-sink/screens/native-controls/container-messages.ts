import type { PopoverBehavior, PopoverEdge } from "@legendapp/spark/ui/popover";
import type { TabBorder, TabPosition } from "@legendapp/spark/ui/tab-view";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Popover and Tab view screens. Readouts of API values (availability, events,
// selected IDs) are data, so flows can assert them in any locale.
export type TabId = "general" | "appearance" | "advanced";
export type AnchorMode = "view" | "rect";
type ContainerMessages = {
  popoverTitle: string;
  behavior: string;
  behaviors: Record<PopoverBehavior, string>;
  edge: string;
  edges: Record<PopoverEdge, string>;
  anchor: string;
  anchors: Record<AnchorMode, string>;
  detachable: string;
  show: string;
  contentTitle: string;
  contentBody: string;
  note: string;
  close: string;
  tabViewTitle: string;
  position: string;
  positions: Record<TabPosition, string>;
  border: string;
  borders: Record<TabBorder, string>;
  lock: string;
  select: string;
  tabs: Record<TabId, { label: string; body: string }>;
};

const en: ContainerMessages = {
  popoverTitle: "Native popover",
  behavior: "Behavior",
  behaviors: { transient: "Transient", "semi-transient": "Semi-transient", "application-defined": "Application-defined" },
  edge: "Preferred edge",
  edges: { top: "Top", bottom: "Bottom", leading: "Leading", trailing: "Trailing" },
  anchor: "Anchor",
  anchors: { view: "Button view", rect: "Window rect" },
  detachable: "Detachable",
  show: "Show popover",
  contentTitle: "Popover content",
  contentBody: "React content laid out top-down in a native popover. Tab moves between the fields.",
  note: "Note",
  close: "Close",
  tabViewTitle: "Native tab view",
  position: "Tab position",
  positions: { top: "Top", bottom: "Bottom", leading: "Leading", trailing: "Trailing", none: "None" },
  border: "Border",
  borders: { bezel: "Bezel", line: "Line", none: "None" },
  lock: "Keep the selected tab",
  select: "Select",
  tabs: {
    general: { label: "General", body: "General settings live in the first tab." },
    appearance: { label: "Appearance", body: "Appearance settings live in the second tab." },
    advanced: { label: "Advanced", body: "Advanced settings live in the third tab." },
  },
};

const ar: ContainerMessages = {
  popoverTitle: "نافذة منبثقة أصلية",
  behavior: "السلوك",
  behaviors: { transient: "عابرة", "semi-transient": "شبه عابرة", "application-defined": "يحددها التطبيق" },
  edge: "الحافة المفضلة",
  edges: { top: "أعلى", bottom: "أسفل", leading: "البداية", trailing: "النهاية" },
  anchor: "نقطة الارتكاز",
  anchors: { view: "عرض الزر", rect: "مستطيل في النافذة" },
  detachable: "قابلة للفصل",
  show: "إظهار النافذة المنبثقة",
  contentTitle: "محتوى النافذة المنبثقة",
  contentBody: "محتوى React مرتب من الأعلى إلى الأسفل في نافذة منبثقة أصلية. ينتقل مفتاح Tab بين الحقول.",
  note: "ملاحظة",
  close: "إغلاق",
  tabViewTitle: "عرض علامات تبويب أصلي",
  position: "موضع علامات التبويب",
  positions: { top: "أعلى", bottom: "أسفل", leading: "البداية", trailing: "النهاية", none: "بلا" },
  border: "الإطار",
  borders: { bezel: "بارز", line: "خط", none: "بلا" },
  lock: "الإبقاء على علامة التبويب المحددة",
  select: "تحديد",
  tabs: {
    general: { label: "عام", body: "الإعدادات العامة في علامة التبويب الأولى." },
    appearance: { label: "المظهر", body: "إعدادات المظهر في علامة التبويب الثانية." },
    advanced: { label: "متقدم", body: "الإعدادات المتقدمة في علامة التبويب الثالثة." },
  },
};

export const CONTAINER_MESSAGES: Record<Locale, ContainerMessages> = { en, ar };
export function useContainerMessages() { return CONTAINER_MESSAGES[useI18n().locale]; }
