import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, UIManager, View, type NativeSyntheticEvent, type ViewProps } from "react-native";
import NativeView, { Commands } from "./DesktopDragViewNativeComponent";
import { SparkError, parseNativeResult, type Availability, type SparkErrorCode } from "@legendapp/spark-desktop-app/src/contracts";
import {
  DRAG_DROP_FEATURES, DRAG_DROP_FEATURE_PLATFORMS, dragOptions, dragSource, dragDrop, dragEnd, dragPosition, promisedFileRequest, springLoadHighlight,
  type DragDropFeature, type DragSource, type DragOptions, type DragOverEvent, type DropEvent, type DragEndEvent, type PromisedFileWriteRequest, type SpringLoadHighlightEvent,
} from "./contracts";
export type {
  ContextualDragOperations, DragDropFeature, DragImage, DragPayload, DragSource, DragOptions, DragOperation, DragOverEvent, DropEvent, DragEndEvent, PromisedFile,
  PromisedFileWriteRequest, SpringLoadHighlight, SpringLoadHighlightEvent,
} from "./contracts";
/** Props for `DragDropView`: view props, `DragOptions`, a drag `source` and drag event callbacks. `disabled` (default false) ignores drag events. `onError` defaults to `console.error`. */
export interface DragDropViewProps extends ViewProps, DragOptions {
  disabled?: boolean;
  source?: DragSource;
  onDrop?: (event: DropEvent) => void;
  onDragEnter?: (event: DropEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragLeave?: () => void;
  onDragEnd?: (event: DragEndEvent) => void;
  /** Required with `source.promisedFiles`: write the file at `request.path`, resolving once it is written. */
  onPromisedFileWrite?: (request: PromisedFileWriteRequest) => void | Promise<void>;
  /** A spring-loading destination activated: open what the drag hovers, as Finder opens a folder. */
  onSpringLoad?: () => void;
  /** The spring-loading highlight to draw while a drag hovers (the system flashes it before activating). */
  onSpringLoadHighlight?: (event: SpringLoadHighlightEvent) => void;
  onError?: (error: SparkError) => void;
}
/** Drag and drop on this platform, or one of its features. */
export function getDragDropAvailability(feature?: DragDropFeature): Availability {
  if (feature !== undefined && !DRAG_DROP_FEATURES.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown drag and drop feature");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (feature && !DRAG_DROP_FEATURE_PLATFORMS[feature].includes(Platform.OS)) return { available: false, reason: "unsupported-platform" };
  return UIManager.hasViewManagerConfig("DesktopDragView") ? { available: true } : { available: false, reason: "missing-module" };
}
type Event = NativeSyntheticEvent<{ json: string }>;
type NativeFailure = { message: string; unavailable: boolean; code?: SparkErrorCode };
const NATIVE_CODES: readonly string[] = ["E_TIMEOUT", "E_NOT_FOUND", "E_UNAVAILABLE", "E_INVALID_ARGUMENT"];
function useMounted() {
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}
/** Reports an unavailable host through onError once per reason. */
function useUnavailableReport(unavailable: string | undefined, onError: (error: SparkError) => void) {
  const reported = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (unavailable && reported.current !== unavailable) {
      reported.current = unavailable;
      onError(new SparkError(unavailable === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Drag and drop is unavailable"));
    }
  }, [unavailable, onError]);
}
/** A view that is a drag source when `source` is set and a drop target for `acceptedTypes`. Invalid props throw E_INVALID_ARGUMENT. Where drag and drop is unavailable it renders a plain `View` and reports E_UNSUPPORTED_PLATFORM or E_MODULE_UNAVAILABLE through `onError`. macOS and Windows. */
export function DragDropView({
  source, sourceOperations, ignoreModifierKeys, dragImage, acceptedOperations, acceptedTypes, springLoading, disabled = false,
  onDrop, onDragEnter, onDragOver, onDragLeave, onDragEnd, onPromisedFileWrite, onSpringLoad, onSpringLoadHighlight, onError = console.error, ...props
}: DragDropViewProps) {
  const optionsJson = dragOptions({ sourceOperations, ignoreModifierKeys, dragImage, acceptedOperations, acceptedTypes, springLoading }, Platform.OS);
  const sourceJson = source === undefined ? "" : JSON.stringify(dragSource(source, Platform.OS));
  if (typeof disabled !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected disabled to be a boolean");
  for (const handler of [onDrop, onDragEnter, onDragOver, onDragLeave, onDragEnd, onPromisedFileWrite, onSpringLoad, onSpringLoadHighlight, onError]) if (handler !== undefined && typeof handler !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a drag event callback");
  if (source?.promisedFiles && !onPromisedFileWrite) throw new SparkError("E_INVALID_ARGUMENT", "promisedFiles needs onPromisedFileWrite to write them");
  const availability = getDragDropAvailability();
  const [failed, setFailed] = useState(false);
  const mounted = useMounted();
  const native = useRef<React.ComponentRef<typeof NativeView>>(null);
  useUnavailableReport(!availability.available ? availability.reason : undefined, onError);
  function receive<T>(event: Event, parse: (json: string) => T, handler?: (value: T) => void) {
    if (!mounted.current || disabled || failed) return;
    let value: T;
    try { value = parse(event?.nativeEvent?.json); }
    catch (cause) { onError(cause instanceof SparkError ? cause : new SparkError("E_INVALID_DATA", "Invalid native drag event", { cause })); return; }
    handler?.(value);
  }
  function error(event: Event) {
    if (!mounted.current || failed) return;
    let value: NativeFailure;
    try {
      value = parseNativeResult(event?.nativeEvent?.json, (value): value is NativeFailure => !!value && typeof value === "object" && "message" in value && typeof value.message === "string"
        && "unavailable" in value && typeof value.unavailable === "boolean" && (!("code" in value) || NATIVE_CODES.includes(value.code as string)));
    } catch (cause) { onError(cause as SparkError); return; }
    if (value.unavailable) setFailed(true);
    onError(new SparkError(value.code ?? (value.unavailable ? "E_UNAVAILABLE" : "E_NATIVE"), value.message));
  }
  // A destination asked for a promised file: the app writes it, then the native drag hears whether it was written.
  async function writePromisedFile(event: Event) {
    if (!mounted.current) return;
    let request: ReturnType<typeof promisedFileRequest>;
    try { request = promisedFileRequest(event?.nativeEvent?.json); }
    catch (cause) { onError(cause as SparkError); return; }
    let failure = "";
    try {
      if (!onPromisedFileWrite) throw new SparkError("E_INVALID_ARGUMENT", "No onPromisedFileWrite");
      await onPromisedFileWrite({ name: request.name, path: request.path });
    } catch (cause) {
      failure = cause instanceof Error && cause.message ? cause.message : "The promised file was not written";
      onError(new SparkError("E_UNAVAILABLE", `Could not write the promised file ${request.name}`, { cause }));
    }
    if (native.current) Commands.completePromisedFile(native.current, request.id, failure);
  }
  if (!availability.available || failed) return <View {...props} />;
  return <NativeView {...props} ref={native} disabled={disabled} sourceJson={sourceJson} optionsJson={optionsJson} onError={error}
    onDrop={event => receive(event, json => dragDrop(json, Platform.OS), onDrop)}
    onDragEnter={event => receive(event, json => dragDrop(json, Platform.OS), onDragEnter)}
    onDragOver={onDragOver ? event => receive(event, dragPosition, onDragOver) : undefined}
    onDragLeave={() => { if (mounted.current && !disabled && !failed) onDragLeave?.(); }}
    onDragEnd={event => receive(event, dragEnd, onDragEnd)}
    onPromisedFileWrite={event => void writePromisedFile(event)}
    onSpringLoad={() => { if (mounted.current && !disabled && !failed) onSpringLoad?.(); }}
    onSpringLoadHighlight={event => receive(event, springLoadHighlight, onSpringLoadHighlight)} />;
}
