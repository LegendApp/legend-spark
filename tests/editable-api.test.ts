import { beforeEach, describe, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ os: "macos", available: true, call: vi.fn(), listeners: new Set<(event: any) => void>() }));
vi.mock("react-native", () => ({
  Platform: { get OS() { return bridge.os; } },
  TurboModuleRegistry: { get: () => bridge.available ? { call: bridge.call } : null },
  NativeEventEmitter: class {
    addListener(_name: string, listener: (event: any) => void) {
      bridge.listeners.add(listener);
      return { remove() { bridge.listeners.delete(listener); } };
    }
  },
}));
import { applyEdit, cancelEdit, configureEditing, generateEdit, getEditingState, getEditReview, onEditingState, prepareEditMigration, previewEdit, restoreOriginal, showEditor } from "../packages/desktop/editable";
beforeEach(() => { bridge.os = "macos"; bridge.available = true; bridge.call.mockReset().mockResolvedValue("null"); bridge.listeners.clear(); });
describe("public editing API", () => {
  it("is safe to import and check without a native module or supported platform", async () => {
    for (const os of ["ios", "web", "windows", "macos"]) {
      bridge.os = os; bridge.available = false;
      expect((await getEditingState()).enabled).toBe(false);
      onEditingState(() => { throw new Error("should not subscribe"); }).remove();
      await expect(showEditor()).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
    }
    expect(bridge.call).not.toHaveBeenCalled();
  });
  it("lets ordinary application commands configure and generate with an installed CLI", async () => {
    const provider = { kind: "cli" as const, tool: "codex" as const };
    await configureEditing(provider);
    expect(JSON.parse(bridge.call.mock.calls[0]![1])).toEqual({ provider });
    bridge.call.mockResolvedValue(JSON.stringify({ candidate: "abc", status: "needs-review", summary: "Blue", changedFiles: ["App.tsx"] }));
    expect((await generateEdit("Make it blue", { provider, allowSourceSharing: true })).candidate).toBe("abc");
    expect(bridge.call.mock.calls[1]![0]).toBe("editable.prompt");
    expect(JSON.parse(bridge.call.mock.calls[1]![1])).toEqual({ prompt: "Make it blue", provider, allowSourceSharing: true });
  });
  it("supports every review, activation, recovery and migration action without a mounted component", async () => {
    await showEditor(); await getEditingState(); await getEditReview(); await prepareEditMigration(); await previewEdit(); await applyEdit(); await restoreOriginal(); await cancelEdit();
    expect(bridge.call.mock.calls.map(call => call[0])).toEqual(["editable.show", "editable.state", "editable.review", "editable.migrate", "editable.preview", "editable.apply", "editable.original", "editable.cancel"]);
    bridge.call.mockRejectedValue(Object.assign(new Error("busy"), { code: "E_BUSY" }));
    await expect(applyEdit()).rejects.toMatchObject({ code: "E_BUSY" });
  });
  it("delivers progress and removes only the caller's listener", () => {
    const one = vi.fn(), two = vi.fn(); const a = onEditingState(one), b = onEditingState(two);
    const state = { enabled: true, busy: true, phase: "generating" };
    for (const listener of bridge.listeners) listener({ type: "activate" });
    for (const listener of bridge.listeners) listener({ type: "editingState", state });
    expect(one).toHaveBeenCalledExactlyOnceWith(state); expect(two).toHaveBeenCalledExactlyOnceWith(state);
    a.remove(); a.remove();
    for (const listener of bridge.listeners) listener({ type: "editingState", state });
    expect(one).toHaveBeenCalledTimes(1); expect(two).toHaveBeenCalledTimes(2); b.remove();
    expect(bridge.listeners.size).toBe(0);
  });
});
