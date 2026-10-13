import { defineScreens } from "../../shell/registry";
import { Buttons, Indicators, Inputs, Toggles } from "./ControlPrimitives";
import { Glass } from "./Glass";
import { Pickers } from "./Pickers";
import { PopoverScreen } from "./PopoverScreen";
import { Search } from "./Search";
import { SFSymbols } from "./SFSymbols";
import { SidebarDataItems, SidebarDynamicHeights, SidebarReactRows } from "./Sidebar";
import { SplitView } from "./SplitView";
import { OutlineScreen, TableScreen } from "./Table";
import { TabViewScreen } from "./TabViewScreen";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("native-controls", [
  { id: "sidebar-data-items", title: "Sidebar: data items", titles: { ar: "الشريط الجانبي: عناصر من البيانات" }, summary: "Native sidebar rows from data, with a non-selectable row and content layout events.", summaries: { ar: "صفوف شريط جانبي أصلية من البيانات، مع صف غير قابل للتحديد وأحداث تخطيط المحتوى." }, component: SidebarDataItems },
  { id: "sidebar-dynamic-heights", title: "Sidebar: dynamic heights", titles: { ar: "الشريط الجانبي: ارتفاعات متغيّرة" }, summary: "React sidebar rows whose heights follow React layout.", summaries: { ar: "صفوف شريط جانبي من React تتبع ارتفاعاتها تخطيط React." }, component: SidebarDynamicHeights },
  { id: "sidebar-react-rows", title: "Sidebar: React rows", titles: { ar: "الشريط الجانبي: صفوف React" }, summary: "Fixed-height React rows with context-menu events.", summaries: { ar: "صفوف React بارتفاع ثابت مع أحداث القائمة السياقية." }, component: SidebarReactRows },
  { id: "split-view", title: "Split view", titles: { ar: "العرض المقسّم" }, summary: "A native sidebar split view with React sidebar and content panes.", summaries: { ar: "عرض مقسّم أصلي بشريط جانبي، فيه جزءا الشريط الجانبي والمحتوى من React." }, component: SplitView },
  { id: "glass", title: "Glass", titles: { ar: "الزجاج" }, summary: "A native glass effect view.", summaries: { ar: "عرض أصلي بتأثير الزجاج." }, component: Glass },
  { id: "symbol", title: "SF Symbols", titles: { ar: "رموز SF" }, summary: "SF Symbols at several sizes, scales and colors.", summaries: { ar: "رموز SF بعدة أحجام ومقاييس وألوان." }, component: SFSymbols },
  { id: "search", title: "Search field", titles: { ar: "حقل البحث" }, summary: "Native search fields with change events and programmatic focus.", summaries: { ar: "حقول بحث أصلية مع أحداث التغيير والتركيز البرمجي." }, component: Search },
  { id: "toggles", title: "Toggles", titles: { ar: "عناصر التبديل" }, summary: "Checkbox (with mixed), radio group, switch and disclosure triangle in every control size.", summaries: { ar: "خانة اختيار (مع الحالة المختلطة)، ومجموعة أزرار اختيار، ومفتاح تبديل، ومثلث الإفصاح بكل أحجام عناصر التحكم." }, component: Toggles },
  { id: "inputs", title: "Value inputs", titles: { ar: "إدخال القيم" }, summary: "Continuous and ticked sliders, stepper, combo box, token field and path control in every control size.", summaries: { ar: "أشرطة تمرير متصلة وبعلامات، وعدّاد، ومربع تحرير وسرد، وحقل رموز، وعنصر المسار بكل أحجام عناصر التحكم." }, component: Inputs },
  { id: "indicators", title: "Indicators", titles: { ar: "المؤشرات" }, summary: "Determinate, indeterminate and spinner progress and a level indicator, driven by a stepper.", summaries: { ar: "شريط تقدم محدد وغير محدد ومؤشر دوّار ومؤشر مستوى، يحرّكها عدّاد." }, component: Indicators },
  { id: "buttons", title: "Button styles", titles: { ar: "أنماط الأزرار" }, summary: "Push, bevel, toolbar, help and destructive buttons in every size; Return and Escape buttons.", summaries: { ar: "أزرار الضغط والمشطوفة وشريط الأدوات والمساعدة والحذف بكل الأحجام؛ وزرّا الإدخال والهروب." }, component: Buttons },
  { id: "table", title: "Table", titles: { ar: "الجدول" }, summary: "A native NSTableView of 10,000 rows: sorting, column resize and reorder with a controlled layout, multiple selection, activation and context-menu events.", summaries: { ar: "جدول NSTableView أصلي من 10,000 صف: الفرز، وتغيير عرض الأعمدة وترتيبها مع تخطيط متحكَّم فيه، والتحديد المتعدد، وأحداث التنشيط والقائمة السياقية." }, component: TableScreen },
  { id: "outline", title: "Outline", titles: { ar: "المخطط" }, summary: "A native NSOutlineView of 10,010 rows in three levels with controlled expansion and selection.", summaries: { ar: "مخطط NSOutlineView أصلي من 10,010 صفوف في ثلاثة مستويات، مع توسيع وتحديد متحكَّم فيهما." }, component: OutlineScreen },
  { id: "pickers", title: "Pickers", titles: { ar: "المنتقيات" }, summary: "Date, time and calendar pickers, color wells, the system color panel with its eyedropper, and the font panel.", summaries: { ar: "منتقيات التاريخ والوقت والتقويم، وحاويات الألوان، ولوحة الألوان في النظام مع قطّارتها، ولوحة الخطوط." }, component: Pickers },
  { id: "popover", title: "Popover", titles: { ar: "النافذة المنبثقة" }, summary: "A native popover anchored to a view or a window rect, with behaviors, preferred edges, detaching and React content.", summaries: { ar: "نافذة منبثقة أصلية مرتكزة على عرض أو على مستطيل في النافذة، مع السلوكيات والحواف المفضلة والفصل ومحتوى React." }, component: PopoverScreen },
  { id: "tab-view", title: "Tab view", titles: { ar: "عرض علامات التبويب" }, summary: "A native tab view with React content per tab, tab positions and borders, and controlled selection.", summaries: { ar: "عرض علامات تبويب أصلي مع محتوى React لكل علامة، ومواضع علامات التبويب وإطاراتها، وتحديد متحكَّم فيه." }, component: TabViewScreen },
]);
