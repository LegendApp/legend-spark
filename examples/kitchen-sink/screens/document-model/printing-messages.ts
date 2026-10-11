import type { PageSetup } from "@legendapp/spark/printing";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Printing screen and the report it prints. Results and availability are JSON from
// the API, so flows can assert them in any locale; they are not translated.
export type PrintingMessages = {
  sections: { availability: string; pageSetup: string; print: string; export: string };
  paper(setup: PageSetup): string;
  pageSetupHint: string;
  showPageSetup: string;
  systemDefault: string;
  printReport: string;
  printWindow: string;
  printCard: string;
  exportPDF: string;
  kinds: { report: string; window: string; card: string };
  exported(kind: string, pages: number, width: number, height: number): string;
  saveTitle: string;
  noResult: string;
  card: { title: string; lines: readonly [string, string][]; total: [string, string] };
  report: { title: string; intro: string; sections: readonly { heading: string; body: string }[]; tableHeading: string; columns: [string, string, string]; regions: readonly string[]; footer: string };
};

const PAPERS: [width: number, height: number, en: string, ar: string][] = [[612, 792, "US Letter", "خطاب أمريكي"], [612, 1008, "US Legal", "قانوني أمريكي"], [595.28, 841.89, "A4", "A4"], [841.89, 1190.55, "A3", "A3"], [419.53, 595.28, "A5", "A5"]];
const paperName = (setup: PageSetup, locale: Locale) => {
  const known = PAPERS.find(([width, height]) => Math.abs(width - setup.paperSize.width) < 1 && Math.abs(height - setup.paperSize.height) < 1);
  return known ? known[locale === "ar" ? 3 : 2] : `${Math.round(setup.paperSize.width)} × ${Math.round(setup.paperSize.height)} pt`;
};

const SECTIONS_EN = [
  { heading: "Summary", body: "Revenue grew in every region this quarter. The north and coastal stores led the increase, while online orders held steady after the spring promotion ended." },
  { heading: "Operations", body: "Two warehouses moved to the new scheduling system. Average delivery time fell from four days to three, and returns processing now finishes the same day." },
  { heading: "People", body: "We welcomed fourteen new team members and promoted six. The mentoring program now pairs every new hire with an experienced colleague for their first ninety days." },
  { heading: "Outlook", body: "Next quarter focuses on the holiday season: extended hours in the largest stores, a refreshed catalog and a pilot of same-day delivery in two cities." },
];
const SECTIONS_AR = [
  { heading: "الملخص", body: "نمت الإيرادات في كل المناطق هذا الربع. قادت متاجر الشمال والساحل هذه الزيادة، بينما بقيت الطلبات عبر الإنترنت مستقرة بعد انتهاء عرض الربيع." },
  { heading: "العمليات", body: "انتقل مستودعان إلى نظام الجدولة الجديد. انخفض متوسط وقت التوصيل من أربعة أيام إلى ثلاثة، وأصبحت معالجة المرتجعات تنتهي في اليوم نفسه." },
  { heading: "الفريق", body: "رحّبنا بأربعة عشر عضوًا جديدًا ورقّينا ستة. يقرن برنامج الإرشاد الآن كل موظف جديد بزميل خبير خلال أول تسعين يومًا." },
  { heading: "التوقعات", body: "يركّز الربع القادم على موسم الأعياد: ساعات عمل أطول في أكبر المتاجر، وكتالوج محدَّث، وتجربة التوصيل في اليوم نفسه في مدينتين." },
];

const en: PrintingMessages = {
  sections: { availability: "Availability", pageSetup: "Page setup", print: "Print", export: "Export PDF" },
  paper: setup => `${paperName(setup, "en")} · ${setup.orientation === "landscape" ? "Landscape" : "Portrait"} · margins ${setup.margins.top}/${setup.margins.right}/${setup.margins.bottom}/${setup.margins.left} pt`,
  pageSetupHint: "Kept in this app's settings and used by every print and export below.",
  showPageSetup: "Page setup…",
  systemDefault: "Use system default",
  printReport: "Print report…",
  printWindow: "Print this window…",
  printCard: "Print receipt card…",
  exportPDF: "Export report as PDF…",
  kinds: { report: "Report", window: "Window", card: "Receipt card" },
  exported: (kind, pages, width, height) => `${kind}: ${pages} ${pages === 1 ? "page" : "pages"}, ${width} × ${height} pt`,
  saveTitle: "Quarterly report.pdf",
  noResult: "—",
  card: { title: "Receipt #1042", lines: [["Notebook", "$12.00"], ["Fountain pen", "$48.00"], ["Ink, blue", "$9.50"]], total: ["Total", "$69.50"] },
  report: {
    title: "Quarterly report",
    intro: "Prepared for the leadership team. Figures are preliminary until the audit closes.",
    sections: [...SECTIONS_EN, ...SECTIONS_EN.map(section => ({ heading: `${section.heading} (detail)`, body: `${section.body} ${section.body}` }))],
    tableHeading: "Sales by region",
    columns: ["Region", "Orders", "Revenue"],
    regions: ["North", "South", "East", "West", "Coastal", "Mountain", "Central", "Online"],
    footer: "Spark Kitchen Sink · printed with @legendapp/spark/printing",
  },
};

const ar: PrintingMessages = {
  sections: { availability: "التوفر", pageSetup: "إعداد الصفحة", print: "الطباعة", export: "تصدير PDF" },
  paper: setup => `${paperName(setup, "ar")} · ${setup.orientation === "landscape" ? "أفقي" : "عمودي"} · الهوامش ${setup.margins.top}/${setup.margins.right}/${setup.margins.bottom}/${setup.margins.left} نقطة`,
  pageSetupHint: "يُحفظ في إعدادات هذا التطبيق ويُستخدم في كل طباعة وتصدير أدناه.",
  showPageSetup: "إعداد الصفحة…",
  systemDefault: "استخدام إعداد النظام",
  printReport: "طباعة التقرير…",
  printWindow: "طباعة هذه النافذة…",
  printCard: "طباعة بطاقة الإيصال…",
  exportPDF: "تصدير التقرير بصيغة PDF…",
  kinds: { report: "التقرير", window: "النافذة", card: "بطاقة الإيصال" },
  exported: (kind, pages, width, height) => `${kind}: ${pages} ${pages === 1 ? "صفحة" : "صفحات"}، ${width} × ${height} نقطة`,
  saveTitle: "التقرير الربعي.pdf",
  noResult: "—",
  card: { title: "إيصال رقم ١٠٤٢", lines: [["دفتر", "١٢٫٠٠ $"], ["قلم حبر", "٤٨٫٠٠ $"], ["حبر أزرق", "٩٫٥٠ $"]], total: ["الإجمالي", "٦٩٫٥٠ $"] },
  report: {
    title: "التقرير الربعي",
    intro: "أُعدّ لفريق القيادة. الأرقام أولية حتى يكتمل التدقيق.",
    sections: [...SECTIONS_AR, ...SECTIONS_AR.map(section => ({ heading: `${section.heading} (تفاصيل)`, body: `${section.body} ${section.body}` }))],
    tableHeading: "المبيعات حسب المنطقة",
    columns: ["المنطقة", "الطلبات", "الإيرادات"],
    regions: ["الشمال", "الجنوب", "الشرق", "الغرب", "الساحل", "الجبال", "الوسط", "عبر الإنترنت"],
    footer: "Spark Kitchen Sink · طُبع باستخدام ‎@legendapp/spark/printing",
  },
};

export const PRINTING_MESSAGES: Record<Locale, PrintingMessages> = { en, ar };
export function usePrintingMessages() { return PRINTING_MESSAGES[useI18n().locale]; }
