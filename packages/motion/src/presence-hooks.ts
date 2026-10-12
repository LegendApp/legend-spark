import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode, type Ref } from "react";
import { animate, tracks, type MotionAnimationValues, type MotionTarget } from "./motion";
import { Presence, type PresenceEntry, type PresenceState } from "./presence";
import { invalid } from "./specs";

// React bindings of MotionPresence and of MotionView's enter/exit. Internal: the public surface is the two components.

export const PresenceContext = createContext<PresenceState | null>(null);

/** MotionPresence's rendered children; re-renders when an exiting child unmounts. */
export function usePresence(children: ReactNode): readonly PresenceEntry[] {
  const [, changed] = useReducer((count: number) => count + 1, 0);
  const [presence] = useState(() => new Presence(changed));
  const entries = presence.update(children);
  useEffect(() => presence.commit());
  return entries;
}

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * Plays `enter` at mount and when the enclosing presence child comes back, and `exit` when it is removed (the presence
 * keeps it mounted until `exit` settles). Returns the ref for the native view; it also sets the caller's `ref`.
 */
export function usePresenceMotion(ref: Ref<MotionTarget> | undefined, enter: MotionAnimationValues | undefined, exit: MotionAnimationValues | undefined) {
  const presence = useContext(PresenceContext);
  if (enter !== undefined) tracks(enter);
  if (exit !== undefined) {
    tracks(exit);
    if (!presence) invalid("exit needs a MotionPresence ancestor, which keeps the view mounted while it plays");
  }
  const target = useRef<MotionTarget | null>(null);
  const values = useRef({ enter, exit });
  useEffect(() => { values.current = { enter, exit }; });
  const exiting = presence?.exiting ?? false;
  useEffect(() => {
    const { enter, exit } = values.current;
    if (exiting && exit) presence!.register(animate(target.current, exit).finished);
    // An enter rejection (a solver-only rule) stays unhandled, so it is reported.
    else if (!exiting && enter) void animate(target.current, enter).finished;
  }, [exiting, presence]);
  return useCallback((node: MotionTarget | null) => {
    target.current = node;
    assign(ref, node);
    return () => { target.current = null; assign(ref, null); };
  }, [ref]);
}
