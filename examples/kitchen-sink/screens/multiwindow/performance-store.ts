import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * What the Window performance screen's windows report back to it, in the shared runtime: when each open's content
 * first committed, and the throttled clock's value and how often its window rendered.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
const changed = () => { for (const listener of listeners) listener(); };
let clock = { value: 0, renders: 0 };
const commits = new Map<string, number>();

export const subscribeToClock = (listener: Listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getClock = () => clock;
export function advanceClock() { clock = { ...clock, value: clock.value + 1 }; changed(); }
export function resetClock() { clock = { value: 0, renders: 0 }; changed(); }
/** Counted during render, so a frozen (throttled) window counts nothing. Not state: rendering it would render again. */
export function countClockRender() { clock.renders++; }
export function useClockValue() { return useSyncExternalStore(subscribeToClock, () => clock.value); }

/** The first commit time of the content opened with this token. */
export function takeCommit(token: string) { const time = commits.get(token); commits.delete(token); return time; }
export function useCommitMark(token: string) { useLayoutEffect(() => { commits.set(token, performance.now()); }, [token]); }
