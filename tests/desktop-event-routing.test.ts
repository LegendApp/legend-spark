import { expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: {}, receive: undefined as undefined | ((event: unknown) => void), subscribe: vi.fn(), remove: vi.fn() }));
vi.mock("react-native", () => ({ TurboModuleRegistry: { get: () => mocks.native }, NativeEventEmitter: class {
  addListener(_name: string, receive: (event: unknown) => void) { mocks.subscribe(); mocks.receive = receive; return { remove: mocks.remove }; }
} }));
import { onDesktopEvent } from "../packages/desktop-app/src/events";
test("one native subscription routes only to the event type and resource owner", () => {
  const process = vi.fn(), other = vi.fn(), updates = vi.fn();
  const a = onDesktopEvent(process, { types: ["processOutput"], target: { field: "processId", value: "a" } });
  const b = onDesktopEvent(other, { types: ["processOutput"], target: { field: "processId", value: "b" } });
  const c = onDesktopEvent(updates, { types: ["update"] });
  try {
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    const bytes = new Uint8Array([1, 2]).buffer;
    mocks.receive?.({ type: "processOutput", processId: "a", bytes });
    expect(process).toHaveBeenCalledExactlyOnceWith({ type: "processOutput", processId: "a", bytes });
    expect(other).not.toHaveBeenCalled(); expect(updates).not.toHaveBeenCalled();
    a.remove(); mocks.receive?.({ type: "processOutput", processId: "a", bytes });
    expect(process).toHaveBeenCalledTimes(1); expect(mocks.remove).not.toHaveBeenCalled();
  } finally { a.remove(); b.remove(); c.remove(); }
  expect(mocks.remove).toHaveBeenCalledTimes(1);
});
test("removal and new subscriptions during delivery preserve the original recipient snapshot", () => {
  const calls: string[] = [], late = vi.fn();
  let added: ReturnType<typeof onDesktopEvent> | undefined;
  const a = onDesktopEvent(() => { calls.push("a"); b.remove(); added ??= onDesktopEvent(late, { types: ["update"] }); }, { types: ["update"] });
  const b = onDesktopEvent(() => { calls.push("b"); }, { types: ["update"] });
  try {
    mocks.receive?.({ type: "update" });
    expect(calls).toEqual(["a"]); expect(late).not.toHaveBeenCalled();
    mocks.receive?.({ type: "update" }); expect(late).toHaveBeenCalledTimes(1);
  } finally { a.remove(); b.remove(); added?.remove(); }
});
