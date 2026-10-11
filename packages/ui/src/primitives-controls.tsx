import { getNativePrimitive } from "./primitive-host";
import type { NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { getControlAvailability } from "./availability";
import { isEventCount, useControl, useEventAcknowledgment } from "./control";
import { primitiveEventValue, primitivePayload } from "./primitives";
import type { CheckboxProps, RadioGroupProps, SwitchProps, SliderProps, StepperProps, ComboBoxProps, TokenFieldProps, PathControlProps, ProgressProps, LevelIndicatorProps, DisclosureTriangleProps, PrimitiveKind, PrimitivePropsByKind } from "./primitives.types";
export type { ControlSize, PrimitiveKind, PrimitiveControlProps, NumericControlProps, CheckboxValue, CheckboxProps, RadioGroupProps, SwitchProps, DisclosureTriangleProps, SliderProps, StepperProps, LevelIndicatorProps, ComboBoxProps, TokenFieldProps, PathControlProps, ProgressProps } from "./primitives.types";

function Primitive<K extends PrimitiveKind>({ kind, props }: { kind: K; props: PrimitivePropsByKind[K] }) {
  const availability = getControlAvailability(kind);
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `${kind} is unavailable: ${availability.reason}`);
  const valueJson = primitivePayload(kind, props);
  const control = useControl(props);
  const events = useEventAcknowledgment();
  const NativePrimitive = getNativePrimitive();
  // Echo every native event count, even a rejected or vetoed one: native restores the controlled value only once caught up.
  function changed(event: NativeSyntheticEvent<{ valueJson: string; eventCount: number }>) {
    const data = event?.nativeEvent;
    if (!isEventCount(data?.eventCount)) { control.error(new SparkError("E_INVALID_DATA", "Invalid native control event")); return; }
    if (!events.acknowledge(data.eventCount) || !control.active()) return;
    let value: unknown;
    try { value = primitiveEventValue(kind, props, data.valueJson); }
    catch (error) { control.error(error as SparkError); return; }
    if ("onValueChange" in props) (props.onValueChange as (value: unknown) => void)(value);
  }
  function failed(event: NativeSyntheticEvent<{ message: string; eventCount: number }>) {
    const data = event?.nativeEvent;
    if (isEventCount(data?.eventCount)) events.acknowledge(data.eventCount);
    control.error(new SparkError("E_INVALID_DATA", typeof data?.message === "string" ? data.message : "Invalid native control error"));
  }
  const size = props.size ?? "regular", height = { mini: 20, small: 24, regular: 30, large: 36 }[size];
  const label = props.accessibilityLabel ?? ("label" in props ? props.label : undefined);
  return <NativePrimitive ref={control.ref} kind={kind} controlSize={size} valueJson={valueJson} eventCount={events.eventCount} disabled={control.disabled}
    onValueChange={changed} onNativeError={failed} accessibilityLabel={label} testID={props.testID} style={[{ width: 240, height }, props.style]} />;
}
export function Checkbox(props: CheckboxProps) { return <Primitive kind="checkbox" props={props} />; }
export function RadioGroup(props: RadioGroupProps) { return <Primitive kind="radio-group" props={props} />; }
export function Switch(props: SwitchProps) { return <Primitive kind="switch" props={props} />; }
export function Slider(props: SliderProps) { return <Primitive kind="slider" props={props} />; }
export function Stepper(props: StepperProps) { return <Primitive kind="stepper" props={props} />; }
export function ComboBox(props: ComboBoxProps) { return <Primitive kind="combo-box" props={props} />; }
export function TokenField(props: TokenFieldProps) { return <Primitive kind="token-field" props={props} />; }
export function PathControl(props: PathControlProps) { return <Primitive kind="path-control" props={props} />; }
export function Progress(props: ProgressProps) { return <Primitive kind="progress" props={props} />; }
export function LevelIndicator(props: LevelIndicatorProps) { return <Primitive kind="level-indicator" props={props} />; }
export function DisclosureTriangle(props: DisclosureTriangleProps) { return <Primitive kind="disclosure-triangle" props={props} />; }
