import type { ControlProps, SelectOption } from "./types";

export type ControlSize = "mini" | "small" | "regular" | "large";
export type PrimitiveKind = "checkbox" | "radio-group" | "switch" | "slider" | "stepper" | "combo-box" | "token-field" | "path-control" | "progress" | "level-indicator" | "disclosure-triangle" | "date-picker" | "color-well";
export interface PrimitiveControlProps extends ControlProps { size?: ControlSize }
export type CheckboxValue = boolean | "mixed";
export interface CheckboxProps extends PrimitiveControlProps { value: CheckboxValue; onValueChange: (value: CheckboxValue) => void; label?: string }
export interface RadioGroupProps extends PrimitiveControlProps { value: string; options: readonly SelectOption[]; onValueChange: (value: string) => void }
export interface SwitchProps extends PrimitiveControlProps { value: boolean; onValueChange: (value: boolean) => void; label?: string }
export interface DisclosureTriangleProps extends SwitchProps {}
export interface NumericControlProps extends PrimitiveControlProps { value: number; min?: number; max?: number }
export interface SliderProps extends NumericControlProps { step?: number; onValueChange: (value: number) => void; continuous?: boolean; ticks?: number }
export interface StepperProps extends NumericControlProps { step?: number; onValueChange: (value: number) => void }
export interface LevelIndicatorProps extends NumericControlProps {}
export interface ComboBoxProps extends PrimitiveControlProps { value: string; options: readonly string[]; onValueChange: (value: string) => void }
export interface TokenFieldProps extends PrimitiveControlProps { value: readonly string[]; onValueChange: (value: string[]) => void }
/** A file URL, including file:/// for the filesystem root. */
export interface PathControlProps extends PrimitiveControlProps { value: string; onValueChange: (value: string) => void }
export type ProgressProps = PrimitiveControlProps & (
  | { mode?: "determinate"; value: number }
  | { mode: "indeterminate" | "spinner"; value?: never }
);
export type DatePickerMode = "date" | "time" | "date-time";
export type DatePickerVariant = "text-field-stepper" | "text-field" | "clock-calendar";
/** Unicode (BCP 47) calendar identifiers, as `Intl` names them. */
export type DatePickerCalendar = "gregory" | "buddhist" | "chinese" | "coptic" | "ethioaa" | "ethiopic" | "hebrew" | "indian" | "islamic" | "islamic-civil" | "islamic-tbla" | "islamic-umalqura" | "iso8601" | "japanese" | "persian" | "roc";
export interface DatePickerProps extends PrimitiveControlProps {
  /** Unix timestamp in milliseconds. */
  value: number;
  onValueChange: (value: number) => void;
  /** Default `date`. */
  mode?: DatePickerMode;
  /** Default `text-field-stepper`; `clock-calendar` shows a calendar for dates and a clock for times. */
  variant?: DatePickerVariant;
  /** Unix timestamps in milliseconds; the picker never proposes a value outside them. */
  min?: number;
  max?: number;
  /** BCP 47 locale for field order, digits and names. Default: the system locale. */
  locale?: string;
  /** Default: the locale's calendar. */
  calendar?: DatePickerCalendar;
  /** IANA time zone, such as `UTC` or `Asia/Riyadh`. Default: the system time zone. */
  timeZone?: string;
}
export type ColorWellVariant = "default" | "minimal" | "expanded";
export interface ColorWellProps extends PrimitiveControlProps {
  /** sRGB hex: `#rrggbb`, or `#rrggbbaa` when `alpha` is true. Changes report lowercase. */
  value: string;
  onValueChange: (value: string) => void;
  /** Lets the user choose opacity; values then always carry an alpha byte. Default false. */
  alpha?: boolean;
  /** `default` opens the color panel; `minimal` and `expanded` open the system popover. */
  variant?: ColorWellVariant;
}
export interface PrimitivePropsByKind {
  checkbox: CheckboxProps;
  "radio-group": RadioGroupProps;
  switch: SwitchProps;
  slider: SliderProps;
  stepper: StepperProps;
  "combo-box": ComboBoxProps;
  "token-field": TokenFieldProps;
  "path-control": PathControlProps;
  progress: ProgressProps;
  "level-indicator": LevelIndicatorProps;
  "disclosure-triangle": DisclosureTriangleProps;
  "date-picker": DatePickerProps;
  "color-well": ColorWellProps;
}
