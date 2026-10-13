import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";
import type { DisplayRow, SavedRow, WindowRow, WorkspacesState } from "./window-workspaces";

// Strings for the Workspaces screen. Flows assert testIDs, which carry the values in every locale.
export type WorkspacesMessages = {
  title: string;
  availabilityLabel: string; availability(value: string): string;
  name: string;
  displays: string; display(row: DisplayRow): string;
  saved: string; savedRow(row: SavedRow): string; none: string; unreadable: string;
  windows: string; window(row: WindowRow): string;
  lastRestore: string; restore(value: WorkspacesState["restore"]): string;
  restoreButton: string;
  editor(label: string): string; inspector: string; windowText: string;
  run(runs: number, steps: number): string;
  note: string;
  /** The Workspaces menu. */
  menu: { workspaces: string; save: string };
  buttons: Record<"editor" | "inspector" | "save" | "restore" | "delete" | "close" | "clear" | "corrupt" | "refresh", string>;
};

const layouts = { exact: "exact", moved: "moved", scaled: "scaled" } as const;
const en: WorkspacesMessages = {
  title: "Workspaces",
  availabilityLabel: "Availability", availability: value => value,
  name: "Workspace name",
  displays: "Connected displays", display: ({ id, persistentId, primary, width, height }) => `${id}${primary ? " (primary)" : ""} · ${persistentId ?? "no persistent ID"} · work area ${width}×${height}`,
  saved: "Saved workspaces", savedRow: ({ name, windows, displays }) => `${name}: ${windows} windows on ${displays} displays`, none: "None", unreadable: "The workspaces file cannot be read",
  windows: "Open windows", window: ({ label, displayId, x, y, width, height }) => `${label} on ${displayId} at ${x},${y} size ${width}×${height}`,
  lastRestore: "Last restore",
  restore: value => value === null ? "—" : "stopped" in value ? `Stopped: ${value.stopped}` : value.placements.map(({ label, displayId, layout }) => `${label} → ${displayId} (${layouts[layout]})`).join(" · ") || "No windows",
  restoreButton: "Restore",
  editor: label => `Editor ${label}`, inspector: "Inspector", windowText: "Saved and restored with its workspace.",
  run: (runs, steps) => `Run ${runs}: ${steps} steps`,
  note: "The Workspaces menu saves under this name (⌥⌘S) and restores the first nine workspaces with ⌃⌘1–9. macOS has no public API for Spaces or Stage Manager: windows restore on the active Space and Stage Manager arranges them like any new window; fullscreen windows return to fullscreen in their own Spaces. Driven runs never show these windows.",
  menu: { workspaces: "Workspaces", save: "Save Workspace…" },
  buttons: { editor: "Open editor", inspector: "Open inspector", save: "Save workspace", restore: "Restore workspace", delete: "Delete workspace", close: "Close windows", clear: "Delete all workspaces", corrupt: "Damage the workspaces file", refresh: "Refresh" },
};

const n = MESSAGES.ar.number;
/** Width × height in a left-to-right isolate, so right-to-left text keeps the width first. */
const size = (width: number, height: number) => `\u2066${n(width)}×${n(height)}\u2069`;
const arLayouts = { exact: "كما هي", moved: "منقولة", scaled: "مُعاد تحجيمها" } as const;
const ar: WorkspacesMessages = {
  title: "مساحات العمل",
  availabilityLabel: "التوفر", availability: value => ({ available: "متوفرة", "unsupported-platform": "منصة غير مدعومة", "missing-module": "وحدة مفقودة", "host-restriction": "مقيّدة من المضيف" } as Record<string, string>)[value] ?? value,
  name: "اسم مساحة العمل",
  displays: "الشاشات المتصلة", display: ({ id, persistentId, primary, width, height }) => `${id}${primary ? " (الرئيسية)" : ""} · ${persistentId ?? "بلا معرّف دائم"} · منطقة العمل ${size(width, height)}`,
  saved: "مساحات العمل المحفوظة", savedRow: ({ name, windows, displays }) => `${name}: ${n(windows)} نوافذ على ${n(displays)} شاشات`, none: "لا شيء", unreadable: "تعذّرت قراءة ملف مساحات العمل",
  windows: "النوافذ المفتوحة", window: ({ label, displayId, x, y, width, height }) => `${label} على ${displayId} عند ${n(x)}،${n(y)} بحجم ${size(width, height)}`,
  lastRestore: "آخر استعادة",
  restore: value => value === null ? "—" : "stopped" in value ? `توقفت: ${value.stopped}` : value.placements.map(({ label, displayId, layout }) => `${label} ← ${displayId} (${arLayouts[layout]})`).join(" · ") || "لا نوافذ",
  restoreButton: "استعادة",
  editor: label => `المحرر ${label}`, inspector: "المفتش", windowText: "تُحفظ وتُستعاد مع مساحة عملها.",
  run: (runs, steps) => `التشغيل ${n(runs)}: ${n(steps)} خطوات`,
  note: "قائمة مساحات العمل تحفظ بهذا الاسم (\u2066⌥⌘S\u2069) وتستعيد أول تسع مساحات عمل بـ \u2066⌃⌘1\u2069 إلى \u2066⌃⌘9\u2069. لا يوفّر macOS واجهة عامة للمساحات أو لمدير المنصة: تُستعاد النوافذ على المساحة النشطة ويرتّبها مدير المنصة كأي نافذة جديدة؛ وتعود نوافذ ملء الشاشة إلى ملء الشاشة في مساحات خاصة بها. التشغيل الآلي لا يُظهر هذه النوافذ أبدًا.",
  menu: { workspaces: "مساحات العمل", save: "حفظ مساحة العمل…" },
  buttons: { editor: "فتح محرر", inspector: "فتح المفتش", save: "حفظ مساحة العمل", restore: "استعادة مساحة العمل", delete: "حذف مساحة العمل", close: "إغلاق النوافذ", clear: "حذف كل مساحات العمل", corrupt: "إتلاف ملف مساحات العمل", refresh: "تحديث" },
};

export const WORKSPACES_MESSAGES: Record<Locale, WorkspacesMessages> = { en, ar };
export function useWorkspacesMessages() { return WORKSPACES_MESSAGES[useI18n().locale]; }
