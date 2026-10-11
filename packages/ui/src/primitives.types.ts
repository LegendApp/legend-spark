import type { ControlProps, SelectOption } from "./types";

export type ControlSize = "mini" | "small" | "regular" | "large";
export type PrimitiveKind = "checkbox" | "radio-group" | "switch" | "slider" | "stepper" | "combo-box" | "token-field" | "path-control" | "progress" | "level-indicator" | "disclosure-triangle";
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
}
