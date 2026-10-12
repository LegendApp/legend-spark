import { useState, useSyncExternalStore } from "react";
import { findText, lookUp, showFindBar, type TextServicesTarget } from "@legendapp/spark/ui/text-services";

export const FEATURES = ["services", "lookUp", "writingTools", "findBar"] as const;
export const BEHAVIORS = ["default", "complete", "limited", "none"] as const;
export const SAMPLE = "Spark text views offer Services, Look Up and Writing Tools. Find spark with the find bar: Spark, spark and SPARK each match unless Match case is on.";
export const DEFAULT_QUERY = "spark";

type DemoState = { query: string; caseSensitive: boolean; wrap: boolean; result?: string };
const code = (error: unknown) => (error as { code?: string })?.code ?? String(error);

/** The find and Look Up controls of the Text services screen; the note is the target of every operation. */
class TextServicesDemo {
  private state: DemoState = { query: DEFAULT_QUERY, caseSensitive: false, wrap: true };
  private readonly listeners = new Set<() => void>();
  private note: TextServicesTarget | null = null;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly getState = () => this.state;
  readonly noteRef = (note: TextServicesTarget | null) => { this.note = note; };
  set(next: Partial<DemoState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  private async run(operation: () => Promise<unknown>) {
    try {
      const value = await operation();
      this.set({ result: value === undefined ? "ok" : JSON.stringify(value) });
    } catch (error) { this.set({ result: code(error) }); }
  }
  find(backwards: boolean) {
    const { query, caseSensitive, wrap } = this.state;
    return this.run(() => findText(this.note, query, { caseSensitive, wrap, backwards }));
  }
  showFindBar() { return this.run(() => showFindBar(this.note)); }
  lookUp() { return this.run(() => lookUp(this.note)); }
}

export function useTextServicesDemo() {
  const [demo] = useState(() => new TextServicesDemo());
  const state = useSyncExternalStore(demo.subscribe, demo.getState);
  return { demo, state };
}
