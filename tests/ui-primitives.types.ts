import type { CheckboxProps, ComboBoxProps, ProgressProps, LevelIndicatorProps, SliderProps } from "../packages/ui/src/types";
const checkbox: CheckboxProps = { value: "mixed", onValueChange(value) { const state: boolean | "mixed" = value; void state; } };
const combo: ComboBoxProps = { value: "custom", options: ["suggestion"], onValueChange(value) { value.toUpperCase(); } };
const progress: ProgressProps = { mode: "spinner" };
const slider: SliderProps = { value: 3, min: 0, max: 10, step: 1, ticks: 5, continuous: false, size: "mini", onValueChange(value) { value.toFixed(1); } };
// @ts-expect-error Determinate progress requires a value.
const incomplete: ProgressProps = { mode: "determinate" };
// @ts-expect-error Animated progress has no numeric value.
const animatedValue: ProgressProps = { mode: "spinner", value: 0.5 };
// @ts-expect-error Level indicators are displays, without a step option.
const levelStep: LevelIndicatorProps = { value: 4, step: 1 };
// @ts-expect-error Interactive controls are controlled and require their change callback.
const missingCallback: CheckboxProps = { value: true };
void [checkbox, combo, progress, slider, incomplete, animatedValue, levelStep, missingCallback];
