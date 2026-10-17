import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { findNodeHandle, View, type NativeSyntheticEvent } from "react-native";
import { nativeError, SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { isEventCount, useControl, useEventAcknowledgment } from "../control";
import { callback, finite, macosViewAvailability, requireAvailable } from "../specialized";
import NativePopover from "./PopoverNativeComponent";

/** AppKit's NSPopoverBehavior: which outside interactions close the popover. */
export type PopoverBehavior = "transient" | "semi-transient" | "application-defined";
/** The anchor edge the popover prefers. AppKit flips to another edge when the preferred one has no room. */
export type PopoverEdge = "top" | "bottom" | "leading" | "trailing";
/** Logical points from the top-left. */
export interface PopoverRect { x: number; y: number; width: number; height: number }
/**
 * What a `Popover` points at: a host view ref, optionally with a rect within it, or a rect in the window's content.
 * Rects take finite coordinates and nonnegative sizes (E_INVALID_ARGUMENT otherwise).
 */
export type PopoverAnchor =
  /** A mounted React Native host view that is not flattened; `rect` is within it and defaults to its bounds. */
  | { ref: RefObject<View | null>; rect?: PopoverRect }
  /** A rect in the owning window's content. */
  | { rect: PopoverRect; ref?: never };
/**
 * Props for `Popover`. Defaults: `behavior` `transient`, `preferredEdge` `bottom`, `detachable` false. An anchor ref that
 * is not mounted while `open` reports E_NOT_FOUND through `onError`.
 */
export interface PopoverProps {
  /** Controlled. `onClose` reports a close; keep `open` true to show the popover again. */
  open: boolean;
  /** Resolved each time the popover shows. */
  anchor: PopoverAnchor;
  behavior?: PopoverBehavior;
  preferredEdge?: PopoverEdge;
  /** Dragging the popover detaches it into its own window. */
  detachable?: boolean;
  onShow?: () => void;
  onClose: () => void;
  onDetach?: () => void;
  onError?: (error: SparkError) => void;
  testID?: string;
  /** Mounted while the Popover is mounted; the popover takes their layout size. */
  children: ReactNode;
}
const BEHAVIORS: readonly PopoverBehavior[] = ["transient", "semi-transient", "application-defined"];
const EDGES: readonly PopoverEdge[] = ["top", "bottom", "leading", "trailing"];
const STATES = ["shown", "closed", "detached"] as const;
/** Whether `Popover` can render: macOS 14 and later with the native view linked. */
export function getPopoverAvailability() { return macosViewAvailability("SparkPopover"); }

function validRect(rect: unknown): asserts rect is PopoverRect {
  if (!rect || typeof rect !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Expected an anchor rect");
  const { x, y, width, height } = rect as PopoverRect;
  finite(x, "anchor x", -Infinity); finite(y, "anchor y", -Infinity); finite(width, "anchor width"); finite(height, "anchor height");
}
function validate({ open, anchor, behavior, preferredEdge, detachable, onShow, onClose, onDetach }: PopoverProps) {
  if (typeof open !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Popover open is a controlled boolean");
  if (typeof onClose !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Popover is controlled and requires onClose");
  callback(onShow, "show"); callback(onDetach, "detach");
  if (!BEHAVIORS.includes(behavior!)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid popover behavior");
  if (!EDGES.includes(preferredEdge!)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid popover edge");
  if (typeof detachable !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected detachable boolean");
  if (!anchor || typeof anchor !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Popover requires an anchor");
  if (anchor.ref === undefined) validRect(anchor.rect);
  else {
    if (!anchor.ref || typeof anchor.ref !== "object" || !("current" in anchor.ref)) throw new SparkError("E_INVALID_ARGUMENT", "Expected an anchor ref");
    if (anchor.rect !== undefined) validRect(anchor.rect);
  }
}

/** The anchor's React tag once its ref resolves after commit: 0 for a window rect, -1 while unresolved. */
function useAnchorTag(ref: RefObject<View | null> | undefined, open: boolean, report: (error: SparkError) => void) {
  const [tag, setTag] = useState(ref ? -1 : 0);
  const reported = useRef(false);
  useLayoutEffect(() => {
    const next = ref ? findNodeHandle(ref.current) ?? -1 : 0;
    setTag(next);
    if (next !== -1 || !open) { reported.current = false; return; }
    if (!reported.current) { reported.current = true; report(new SparkError("E_NOT_FOUND", "Popover anchor ref is not mounted")); }
  });
  return tag;
}

/** An AppKit popover hosting React content. macOS only; elsewhere rendering throws. */
export function Popover(props: PopoverProps) {
  const { open, anchor, behavior = "transient", preferredEdge = "bottom", detachable = false, onShow, onClose, onDetach, onError, testID, children } = props;
  validate({ ...props, behavior, preferredEdge, detachable });
  requireAvailable(getPopoverAvailability(), "Popover");
  const control = useControl({ onError, testID });
  const events = useEventAcknowledgment();
  const anchorTag = useAnchorTag(anchor.ref, open, control.error);
  function changed(event: NativeSyntheticEvent<{ state: string; eventCount: number }>) {
    const data = event?.nativeEvent;
    if (!isEventCount(data?.eventCount) || !STATES.includes(data.state as typeof STATES[number])) { control.error(new SparkError("E_INVALID_DATA", "Invalid native popover event")); return; }
    if (!events.acknowledge(data.eventCount) || !control.active()) return;
    if (data.state === "shown") onShow?.(); else if (data.state === "closed") onClose(); else onDetach?.();
  }
  function failed(event: NativeSyntheticEvent<{ code: string; message: string }>) {
    const data = event?.nativeEvent;
    control.error(typeof data?.code === "string" && typeof data.message === "string" ? nativeError(Object.assign(new Error(data.message), { code: data.code })) : new SparkError("E_INVALID_DATA", "Invalid native popover error"));
  }
  const rect = anchor.rect;
  return <NativePopover open={open} eventCount={events.eventCount} behavior={behavior} preferredEdge={preferredEdge} detachable={detachable}
    anchorTag={anchorTag} hasAnchorRect={rect !== undefined} anchorX={rect?.x ?? 0} anchorY={rect?.y ?? 0} anchorWidth={rect?.width ?? 0} anchorHeight={rect?.height ?? 0}
    onPopoverChange={changed} onPopoverError={failed} testID={testID} style={HOST}>
    {/* One unconstrained child: native sizes the popover to its layout. */}
    <View collapsable={false} style={CONTENT}>{children}</View>
  </NativePopover>;
}
const HOST = { position: "absolute", width: 0, height: 0 } as const;
const CONTENT = { position: "absolute", left: 0, top: 0 } as const;
