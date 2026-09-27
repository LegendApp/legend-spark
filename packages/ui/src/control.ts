import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import type { ButtonProps, ControlProps, ControlRef, TextInputProps } from "./types";
export type MeasureTarget = ControlRef | null;
export function useControl(props: ControlProps, availability: Availability = { available: true }) {
  const { disabled = false, onError = console.error } = props;
  if (typeof disabled !== "boolean" || typeof onError !== "function" || (props.accessibilityLabel !== undefined && typeof props.accessibilityLabel !== "string") || (props.testID !== undefined && typeof props.testID !== "string")) throw new SparkError("E_INVALID_ARGUMENT", "Invalid control options");
  const target = useRef<MeasureTarget>(null), mounted = useRef(false), reported = useRef<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reason = availability.available ? undefined : availability.reason;
  useEffect(() => {
    if (reason && reported.current !== reason) {
      reported.current = reason;
      onError(new SparkError(reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : reason === "missing-module" ? "E_MODULE_UNAVAILABLE" : "E_UNAVAILABLE", "Native control is unavailable"));
    }
  }, [reason, onError]);
  useImperativeHandle(props.ref, () => ({ measureInWindow(callback) {
    if (typeof callback !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a measurement callback");
    if (!target.current || !mounted.current) throw new SparkError("E_CLOSED", "Control is not mounted");
    target.current.measureInWindow((...bounds) => { if (mounted.current) callback(...bounds); });
  } }), []);
  function error(error: SparkError) { if (mounted.current) onError(error); }
  function unavailable(event: { nativeEvent: { message: string } }) {
    if (!mounted.current) return;
    if (typeof event?.nativeEvent?.message !== "string") { error(new SparkError("E_INVALID_DATA", "Invalid native control error")); return; }
    setFailed(true); error(new SparkError("E_UNAVAILABLE", event.nativeEvent.message));
  }
  const ref = useCallback((value: MeasureTarget) => { target.current = value; }, []);
  return { ref, disabled, failed: failed || !availability.available, error, unavailable, active: () => mounted.current && !disabled && !failed && availability.available };
}
export function validateButton(props: ButtonProps) {
  if (typeof props.children !== "string" || !props.children.length || (props.onPress !== undefined && typeof props.onPress !== "function") || (props.variant !== undefined && !["default", "bordered", "borderless"].includes(props.variant))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid button options");
}
export function useTextValue(props: TextInputProps) {
  const controlled = props.value !== undefined;
  const initialMode = useRef(controlled), initialText = useRef(props.defaultValue ?? ""), latestCount = useRef(0);
  if (initialMode.current !== controlled) throw new SparkError("E_INVALID_ARGUMENT", "TextInput cannot switch controlled mode; remount it instead");
  if ((controlled && (typeof props.value !== "string" || props.defaultValue !== undefined)) || (props.defaultValue !== undefined && typeof props.defaultValue !== "string") || (props.onChangeText !== undefined && typeof props.onChangeText !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "TextInput requires a string value or defaultValue, not both");
  const [eventCount, setEventCount] = useState(0);
  return { controlled, text: props.value ?? "", defaultText: initialText.current, eventCount, acknowledge(count: number) { if (count <= latestCount.current) return false; latestCount.current = count; setEventCount(count); return true; } };
}
