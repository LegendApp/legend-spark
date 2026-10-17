import type { ControlProps, SelectOption } from "./types";

/** AppKit control size. Default `regular`. */
export type ControlSize = "mini" | "small" | "regular" | "large";
/** The macOS-only primitive controls, as `getControlAvailability` names them. */
export type PrimitiveKind = "checkbox" | "radio-group" | "switch" | "slider" | "stepper" | "combo-box" | "token-field" | "path-control" | "progress" | "level-indicator" | "disclosure-triangle" | "date-picker" | "color-well";
/** Props shared by the primitive controls: `ControlProps` plus a control size. */
export interface PrimitiveControlProps extends ControlProps { size?: ControlSize }
/** A checkbox state: checked, unchecked, or `mixed`. */
export type CheckboxValue = boolean | "mixed";
/** On macOS the checkbox sits at the leading edge of its frame at its own size and takes clicks on its box and label only, as an AppKit checkbox does. */
export interface CheckboxProps extends PrimitiveControlProps { value: CheckboxValue; onValueChange: (value: CheckboxValue) => void; label?: string }
/** Props for `RadioGroup`; `value` must match one of `options`. */
export interface RadioGroupProps extends PrimitiveControlProps { value: string; options: readonly SelectOption[]; onValueChange: (value: string) => void }
/** Props for `Switch`. */
export interface SwitchProps extends PrimitiveControlProps { value: boolean; onValueChange: (value: boolean) => void; label?: string }
/** Props for `DisclosureTriangle`, the same as a switch's. */
export interface DisclosureTriangleProps extends SwitchProps {}
/**
 * Props shared by the numeric controls. `value` must lie within `min` (default 0) and `max` (default 100), and `min` must be
 * below `max` (E_INVALID_ARGUMENT otherwise).
 */
export interface NumericControlProps extends PrimitiveControlProps { value: number; min?: number; max?: number }
/** Props for `Slider`. `step` defaults to 1; `ticks` is the number of tick marks, 0 to 1000 (default 0); `continuous` defaults to true. */
export interface SliderProps extends NumericControlProps { step?: number; onValueChange: (value: number) => void; continuous?: boolean; ticks?: number }
/** Props for `Stepper`; `step` must be positive and defaults to 1. */
export interface StepperProps extends NumericControlProps { step?: number; onValueChange: (value: number) => void }
/** Props for `LevelIndicator`, which reports no changes. */
export interface LevelIndicatorProps extends NumericControlProps {}
/** Props for `ComboBox`; `value` is the text and need not be one of `options`. */
export interface ComboBoxProps extends PrimitiveControlProps { value: string; options: readonly string[]; onValueChange: (value: string) => void }
/** Props for `TokenField`; `value` is the tokens in order. */
export interface TokenFieldProps extends PrimitiveControlProps { value: readonly string[]; onValueChange: (value: string[]) => void }
/** A file URL, including file:/// for the filesystem root. */
export interface PathControlProps extends PrimitiveControlProps { value: string; onValueChange: (value: string) => void }
/** Props for `Progress`: `determinate` (default) takes a `value` from 0 to 1; `indeterminate` and `spinner` take none. */
export type ProgressProps = PrimitiveControlProps & (
  | { mode?: "determinate"; value: number }
  | { mode: "indeterminate" | "spinner"; value?: never }
);
/** What a `DatePicker` edits: the date, the time, or both. */
export type DatePickerMode = "date" | "time" | "date-time";
/** AppKit date picker style: a text field with or without a stepper, or a graphical clock and calendar. */
export type DatePickerVariant = "text-field-stepper" | "text-field" | "clock-calendar";
/** Unicode (BCP 47) calendar identifiers, as `Intl` names them. */
export type DatePickerCalendar = "gregory" | "buddhist" | "chinese" | "coptic" | "ethioaa" | "ethiopic" | "hebrew" | "indian" | "islamic" | "islamic-civil" | "islamic-tbla" | "islamic-umalqura" | "iso8601" | "japanese" | "persian" | "roc";
/** Props for `DatePicker`. Invalid values throw E_INVALID_ARGUMENT. */
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
/** AppKit color well style; see `ColorWellProps.variant`. Default `default`. */
export type ColorWellVariant = "default" | "minimal" | "expanded";
/** Props for `ColorWell`. */
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
