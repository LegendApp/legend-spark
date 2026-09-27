import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, UIManager, View, type NativeSyntheticEvent, type ViewProps } from "react-native";
import NativeView from "./DesktopDragViewNativeComponent";
import { SparkError, parseNativeResult, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { dragConfiguration, dragSource, dragDrop, dragEnd, dragPosition, type DragPayload, type DragOptions, type DragOverEvent, type DropEvent, type DragEndEvent } from "./contracts";
export type { DragPayload, DragOptions, DragOperation, DragOverEvent, DropEvent, DragEndEvent } from "./contracts";
export interface DragDropViewProps extends ViewProps, DragOptions {
  disabled?: boolean;
  source?: DragPayload;
  onDrop?: (event: DropEvent) => void;
  onDragEnter?: (event: DropEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragLeave?: () => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onError?: (error: SparkError) => void;
}
export function getDragDropAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return UIManager.hasViewManagerConfig("DesktopDragView") ? { available: true } : { available: false, reason: "missing-module" };
}
type Event = NativeSyntheticEvent<{ json: string }>;
export function DragDropView({ source, sourceOperations, acceptedOperations, acceptedTypes, disabled = false, onDrop, onDragEnter, onDragOver, onDragLeave, onDragEnd, onError = console.error, ...props }: DragDropViewProps) {
  const optionsJson = dragConfiguration(source, { sourceOperations, acceptedOperations, acceptedTypes }, Platform.OS);
  const sourceJson = source === undefined ? "" : JSON.stringify(dragSource(source, Platform.OS));
  if (typeof disabled !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected disabled to be a boolean");
  for (const handler of [onDrop, onDragEnter, onDragOver, onDragLeave, onDragEnd, onError]) if (handler !== undefined && typeof handler !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a drag event callback");
  const availability = getDragDropAvailability();
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false), reported = useRef<string | undefined>(undefined);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const unavailable = !availability.available ? availability.reason : undefined;
  useEffect(() => {
    if (unavailable && reported.current !== unavailable) {
      reported.current = unavailable;
      onError(new SparkError(unavailable === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Drag and drop is unavailable"));
    }
  }, [unavailable, onError]);
  function receive<T>(event: Event, parse: (json: string) => T, handler?: (value: T) => void) {
    if (!mounted.current || disabled || failed) return;
    let value: T;
    try { value = parse(event?.nativeEvent?.json); }
    catch (cause) { onError(cause instanceof SparkError ? cause : new SparkError("E_INVALID_DATA", "Invalid native drag event", { cause })); return; }
    handler?.(value);
  }
  function error(event: Event) {
    if (!mounted.current || failed) return;
    let value: { message: string; unavailable: boolean };
    try { value = parseNativeResult(event?.nativeEvent?.json, (value): value is { message: string; unavailable: boolean } => !!value && typeof value === "object" && "message" in value && typeof value.message === "string" && "unavailable" in value && typeof value.unavailable === "boolean"); }
    catch (cause) { onError(cause as SparkError); return; }
    if (value.unavailable) setFailed(true);
    onError(new SparkError(value.unavailable ? "E_UNAVAILABLE" : "E_NATIVE", value.message));
  }
  if (!availability.available || failed) return <View {...props} />;
  return <NativeView {...props} disabled={disabled} sourceJson={sourceJson} optionsJson={optionsJson} onError={error}
    onDrop={event => receive(event, json => dragDrop(json, Platform.OS), onDrop)}
    onDragEnter={event => receive(event, json => dragDrop(json, Platform.OS), onDragEnter)}
    onDragOver={onDragOver ? event => receive(event, dragPosition, onDragOver) : undefined}
    onDragLeave={() => { if (mounted.current && !disabled && !failed) onDragLeave?.(); }}
    onDragEnd={event => receive(event, dragEnd, onDragEnd)} />;
}
