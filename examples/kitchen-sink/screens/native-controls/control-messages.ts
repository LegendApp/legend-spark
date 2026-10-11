import type { ControlSize } from "@legendapp/spark/ui";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the control primitive screens. Value and availability readouts are JSON
// data from the API, so they are not translated.
export type ControlRow =
  | "checkbox" | "checkbox-mixed" | "radio-group" | "switch" | "disclosure-triangle"
  | "slider" | "slider-ticks" | "stepper" | "combo-box" | "token-field" | "path-control"
  | "progress" | "progress-indeterminate" | "progress-spinner" | "level-indicator"
  | "plain" | "push" | "bevel" | "toolbar" | "help" | "destructive";
type ControlMessages = {
  sizes: Record<ControlSize, string>;
  rows: Record<ControlRow, string>;
  disable: string;
  sizeColumn: string;
  checkboxLabel: string;
  switchLabel: string;
  disclosureLabel: string;
  radioOptions: { first: string; second: string };
  amount: string;
  keyboard: string;
  keyboardSize: string;
  defaultButton: string;
  cancelButton: string;
  plainButton: string;
  /** Accessibility label for a sample: the row and its size. */
  label(row: string, size: string): string;
};

const en: ControlMessages = {
  sizes: { mini: "Mini", small: "Small", regular: "Regular", large: "Large" },
  rows: {
    checkbox: "Checkbox", "checkbox-mixed": "Mixed checkbox", "radio-group": "Radio group", switch: "Switch", "disclosure-triangle": "Disclosure triangle",
    slider: "Continuous slider", "slider-ticks": "Slider with ticks", stepper: "Stepper", "combo-box": "Combo box", "token-field": "Token field", "path-control": "Path control",
    progress: "Progress", "progress-indeterminate": "Indeterminate progress", "progress-spinner": "Spinner", "level-indicator": "Level indicator",
    plain: "Plain (no variant)", push: "Push", bevel: "Bevel", toolbar: "Toolbar", help: "Help", destructive: "Destructive",
  },
  disable: "Disable controls",
  sizeColumn: "Control",
  checkboxLabel: "Selected",
  switchLabel: "Enabled",
  disclosureLabel: "Details",
  radioOptions: { first: "First", second: "Second" },
  amount: "Amount",
  keyboard: "Return and Escape",
  keyboardSize: "Button size",
  defaultButton: "Default",
  cancelButton: "Cancel",
  plainButton: "Plain",
  label: (row, size) => `${row}, ${size}`,
};

const ar: ControlMessages = {
  sizes: { mini: "صغير جدًا", small: "صغير", regular: "عادي", large: "كبير" },
  rows: {
    checkbox: "خانة اختيار", "checkbox-mixed": "خانة اختيار مختلطة", "radio-group": "مجموعة أزرار اختيار", switch: "مفتاح تبديل", "disclosure-triangle": "مثلث الإفصاح",
    slider: "شريط تمرير متصل", "slider-ticks": "شريط تمرير بعلامات", stepper: "عدّاد", "combo-box": "مربع تحرير وسرد", "token-field": "حقل رموز", "path-control": "عنصر المسار",
    progress: "شريط التقدم", "progress-indeterminate": "تقدم غير محدد", "progress-spinner": "مؤشر دوّار", "level-indicator": "مؤشر المستوى",
    plain: "عادي (بلا نمط)", push: "زر ضغط", bevel: "زر مشطوف", toolbar: "شريط الأدوات", help: "مساعدة", destructive: "إجراء حذف",
  },
  disable: "تعطيل عناصر التحكم",
  sizeColumn: "عنصر التحكم",
  checkboxLabel: "محدد",
  switchLabel: "مفعّل",
  disclosureLabel: "التفاصيل",
  radioOptions: { first: "الأول", second: "الثاني" },
  amount: "المقدار",
  keyboard: "الإدخال والهروب",
  keyboardSize: "حجم الزر",
  defaultButton: "افتراضي",
  cancelButton: "إلغاء",
  plainButton: "عادي",
  label: (row, size) => `${row}، ${size}`,
};

export const CONTROL_MESSAGES: Record<Locale, ControlMessages> = { en, ar };
export function useControlMessages() { return CONTROL_MESSAGES[useI18n().locale]; }
