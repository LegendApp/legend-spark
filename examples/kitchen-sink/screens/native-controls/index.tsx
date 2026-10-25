import { defineScreens } from "../../shell/registry";
import { Glass } from "./Glass";
import { Search } from "./Search";
import { SFSymbols } from "./SFSymbols";
import { SidebarDataItems, SidebarDynamicHeights, SidebarReactRows } from "./Sidebar";
import { SplitView } from "./SplitView";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("native-controls", [
  { id: "sidebar-data-items", title: "Sidebar: data items", titles: { ar: "الشريط الجانبي: عناصر من البيانات" }, summary: "Native sidebar rows from data, with a non-selectable row and content layout events.", summaries: { ar: "صفوف شريط جانبي أصلية من البيانات، مع صف غير قابل للتحديد وأحداث تخطيط المحتوى." }, component: SidebarDataItems },
  { id: "sidebar-dynamic-heights", title: "Sidebar: dynamic heights", titles: { ar: "الشريط الجانبي: ارتفاعات متغيّرة" }, summary: "React sidebar rows whose heights follow React layout.", summaries: { ar: "صفوف شريط جانبي من React تتبع ارتفاعاتها تخطيط React." }, component: SidebarDynamicHeights },
  { id: "sidebar-react-rows", title: "Sidebar: React rows", titles: { ar: "الشريط الجانبي: صفوف React" }, summary: "Fixed-height React rows with context-menu events.", summaries: { ar: "صفوف React بارتفاع ثابت مع أحداث القائمة السياقية." }, component: SidebarReactRows },
  { id: "split-view", title: "Split view", titles: { ar: "العرض المقسّم" }, summary: "A native sidebar split view with React sidebar and content panes.", summaries: { ar: "عرض مقسّم أصلي بشريط جانبي، فيه جزءا الشريط الجانبي والمحتوى من React." }, component: SplitView },
  { id: "glass", title: "Glass", titles: { ar: "الزجاج" }, summary: "A native glass effect view.", summaries: { ar: "عرض أصلي بتأثير الزجاج." }, component: Glass },
  { id: "symbol", title: "SF Symbols", titles: { ar: "رموز SF" }, summary: "SF Symbols at several sizes, scales and colors.", summaries: { ar: "رموز SF بعدة أحجام ومقاييس وألوان." }, component: SFSymbols },
  { id: "search", title: "Search field", titles: { ar: "حقل البحث" }, summary: "Native search fields with change events and programmatic focus.", summaries: { ar: "حقول بحث أصلية مع أحداث التغيير والتركيز البرمجي." }, component: Search },
]);
