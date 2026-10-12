import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { invalid } from "./specs";

// MotionPresence's bookkeeping, without React hooks: which children render, which of them are exiting, and when an
// exiting one unmounts (docs/motion.md#presence).

/** What a MotionView inside a presence child sees: whether the child is exiting, and where to hand its exit animation. */
export interface PresenceState {
  readonly exiting: boolean;
  /** Called by MotionViews with `exit` while the child exits; the child unmounts once every registered animation settles. */
  register(finished: Promise<unknown>): void;
}
export interface PresenceEntry { readonly key: string; readonly element: ReactElement; readonly state: PresenceState }

const PRESENT: PresenceState = Object.freeze({ exiting: false, register: () => invalid("Only an exiting MotionPresence child takes exit animations") });

export class Presence {
  private entries: PresenceEntry[] = [];
  private readonly exits = new Map<PresenceState, Promise<unknown>[]>();
  private readonly awaited = new WeakSet<PresenceState>();
  constructor(private readonly changed: () => void) {}

  /** The children to render: `children` in order, with each removed child kept, exiting, where it was. Idempotent. */
  update(children: ReactNode): readonly PresenceEntry[] {
    const next = Children.toArray(children).map(child => isValidElement(child) ? child : invalid("MotionPresence children must be elements"));
    const keys = new Set(next.map(element => String(element.key)));
    const previous = new Map(this.entries.map(entry => [entry.key, entry]));
    const result: PresenceEntry[] = [], placed = new Set<string>();
    let index = 0;
    const place = (until?: string) => {
      while (index < next.length) {
        const element = next[index++]!, key = String(element.key);
        if (!placed.has(key)) {
          placed.add(key);
          // A child that comes back while it exits is present again: its MotionViews play `enter`, interrupting `exit`.
          result.push({ key, element, state: PRESENT });
        }
        if (key === until) return;
      }
    };
    for (const entry of this.entries) {
      if (keys.has(entry.key)) { if (!placed.has(entry.key)) place(entry.key); }
      else result.push(entry.state.exiting ? entry : { ...entry, state: this.exiting() });
    }
    place();
    this.entries = result;
    return result;
  }

  /** After a commit, once MotionViews registered their exits: each newly exiting child unmounts when they settle. */
  commit() {
    for (const { state } of this.entries) {
      if (!state.exiting || this.awaited.has(state)) continue;
      this.awaited.add(state);
      const exits = this.exits.get(state) ?? [];
      this.exits.delete(state);
      // A rejected exit still unmounts its child, and its rejection stays unhandled so it is reported.
      void Promise.all(exits).finally(() => {
        if (!this.entries.some(entry => entry.state === state)) return;
        this.entries = this.entries.filter(entry => entry.state !== state);
        this.changed();
      });
    }
  }

  private exiting(): PresenceState {
    const exits: Promise<unknown>[] = [];
    const state: PresenceState = Object.freeze({ exiting: true, register: (finished: Promise<unknown>) => { exits.push(finished); } });
    this.exits.set(state, exits);
    return state;
  }
}
