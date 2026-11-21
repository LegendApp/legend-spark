import { defineScreens, lazyScreen } from "../../shell/registry";
import { CommonControls } from "./CommonControls";
import { Glass } from "./Glass";
import { PaneSplitViewDemo } from "./PaneSplitViewDemo";
import { PopoverDemo } from "./PopoverDemo";
import { SettingsDemo } from "./SettingsDemo";
import { Search } from "./Search";
import { SheetDemo } from "./SheetDemo";
import { TableDemo } from "./TableDemo";
import { SFSymbols } from "./SFSymbols";
import { SidebarDataItems, SidebarDynamicHeights, SidebarPlainList, SidebarReactRows, SidebarTree, SidebarTreeReactRows } from "./Sidebar";
import { SplitView } from "./SplitView";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("native-controls", [
  { id: "sidebar-data-items", title: "Sidebar: data items", titles: { ar: "الشريط الجانبي: عناصر من البيانات" }, summary: "Native sidebar rows from data, with a non-selectable row and content layout events.", summaries: { ar: "صفوف شريط جانبي أصلية من البيانات، مع صف غير قابل للتحديد وأحداث تخطيط المحتوى." }, component: SidebarDataItems },
  { id: "sidebar-dynamic-heights", title: "Sidebar: dynamic heights", titles: { ar: "الشريط الجانبي: ارتفاعات متغيّرة" }, summary: "React sidebar rows whose heights follow React layout.", summaries: { ar: "صفوف شريط جانبي من React تتبع ارتفاعاتها تخطيط React." }, component: SidebarDynamicHeights },
  { id: "sidebar-react-rows", title: "Sidebar: React rows", titles: { ar: "الشريط الجانبي: صفوف React" }, summary: "Fixed-height React rows with context-menu events.", summaries: { ar: "صفوف React بارتفاع ثابت مع أحداث القائمة السياقية." }, component: SidebarReactRows },
  { id: "sidebar-plain-list", title: "Sidebar: plain list", titles: { ar: "الشريط الجانبي: قائمة عادية" }, summary: "The plain list style for lists inside content, with native selection.", summaries: { ar: "نمط القائمة العادية للقوائم داخل المحتوى، مع تحديد أصلي." }, component: SidebarPlainList },
  { id: "sidebar-tree", title: "Sidebar: tree", titles: { ar: "الشريط الجانبي: شجرة" }, summary: "Source-list section headers, nested rows, trailing counts, collapsible sections, double-click and multiple selection.", summaries: { ar: "عناوين أقسام قائمة المصادر، وصفوف متداخلة، وأعداد في نهاية الصف، وأقسام قابلة للطي، والنقر المزدوج، والتحديد المتعدد." }, component: SidebarTree },
  { id: "sidebar-tree-react-rows", title: "Sidebar: tree of React rows", titles: { ar: "الشريط الجانبي: شجرة من صفوف React" }, summary: "React rows nested with parentId under a group row, with a trailing count.", summaries: { ar: "صفوف React متداخلة عبر parentId تحت صف مجموعة، مع عدد في نهاية الصف." }, component: SidebarTreeReactRows },
  { id: "common-controls", title: "Buttons, checkboxes, radios and segments", titles: { ar: "الأزرار ومربعات الاختيار وأزرار الاختيار والمقاطع" }, summary: "Intrinsically sized buttons, checkboxes, a disclosure button, radio groups, small and fill segmented controls, and placeholder and multiline text inputs.", summaries: { ar: "أزرار بحجمها الطبيعي، ومربعات اختيار، وزر إفصاح، ومجموعات أزرار اختيار، وعناصر تحكم مقسّمة صغيرة وممتدة، وحقول نص بنص بديل ومتعددة الأسطر." }, component: CommonControls },
  { id: "settings", title: "Settings window", titles: { ar: "نافذة الإعدادات" }, summary: "A scrolling macOS settings window with native controls and an icon sidebar.", summaries: { ar: "نافذة إعدادات قابلة للتمرير على macOS مع عناصر تحكم أصلية وشريط جانبي بأيقونات." }, component: SettingsDemo },
  { id: "popover", title: "Popover", titles: { ar: "النافذة المنبثقة" }, summary: "An NSPopover hosting React content, anchored to a button or to a rect inside a view.", summaries: { ar: "‏NSPopover يستضيف محتوى React، مثبّت على زر أو على مستطيل داخل عرض." }, component: PopoverDemo },
  { id: "table", title: "Table", titles: { ar: "الجدول" }, summary: "An NSTableView with a header, columns, 5,000 rows, single or multiple selection and double-click.", summaries: { ar: "‏NSTableView بعنوان وأعمدة و5000 صف، مع تحديد مفرد أو متعدد ونقر مزدوج." }, component: TableDemo },
  { id: "sheet", title: "Sheet", titles: { ar: "الورقة" }, summary: "A sheet on the window hosting a React form, with a placeholder and a multiline text input.", summaries: { ar: "ورقة على النافذة تستضيف نموذج React، مع نص بديل وحقل نص متعدد الأسطر." }, component: SheetDemo },
  { id: "split-view", title: "Split view", titles: { ar: "العرض المقسّم" }, summary: "A native sidebar split view with React sidebar and content panes.", summaries: { ar: "عرض مقسّم أصلي بشريط جانبي، فيه جزءا الشريط الجانبي والمحتوى من React." }, component: SplitView },
  { id: "pane-split-view", title: "Nested split panes", titles: { ar: "أجزاء مقسّمة متداخلة" }, summary: "Drag three columns and a nested vertical split inside the sidebar’s detail pane.", summaries: { ar: "اسحب الفواصل بين ثلاثة أعمدة وتقسيم عمودي متداخل داخل جزء تفاصيل الشريط الجانبي." }, component: PaneSplitViewDemo },
  { id: "glass", title: "Glass", titles: { ar: "الزجاج" }, summary: "A native glass effect view.", summaries: { ar: "عرض أصلي بتأثير الزجاج." }, component: Glass },
  { id: "symbol", title: "SF Symbols", titles: { ar: "رموز SF" }, summary: "SF Symbols at several sizes, scales and colors.", summaries: { ar: "رموز SF بعدة أحجام ومقاييس وألوان." }, component: SFSymbols },
  { id: "search", title: "Search field", titles: { ar: "حقل البحث" }, summary: "Native search fields with change events and programmatic focus.", summaries: { ar: "حقول بحث أصلية مع أحداث التغيير والتركيز البرمجي." }, component: Search },
  { id: "datetimepicker", title: "Date & time picker", titles: { ar: "منتقي التاريخ والوقت" }, summary: "@react-native-community/datetimepicker on desktop: date, time and inline calendar pickers hosted in AppKit's NSDatePicker.", summaries: { ar: "‏@react-native-community/datetimepicker على سطح المكتب: منتقيات التاريخ والوقت والتقويم المضمّن داخل NSDatePicker في AppKit." }, component: lazyScreen(() => require("./DateTimePickerDemo").DateTimePickerDemo) },
]);
