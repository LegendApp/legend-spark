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
import { applyEdit, beginCustomizeGitHubAuth, cancelEdit, completeCustomizeGitHubAuth, configureCustomize, generateEdit, getCustomizeState, getEditReview, onCustomizeState, prepareEditMigration, previewEdit, restoreOriginal, showEditor, signOutCustomizeGitHub, submitEditPullRequest } from "../packages/desktop/customize";
const state = { enabled: true, busy: false, phase: "idle", message: "Ready", ready: true, customized: false, previewing: false, migrationAvailable: false };
beforeEach(() => { bridge.os = "macos"; bridge.available = true; bridge.call.mockReset().mockResolvedValue("null"); bridge.listeners.clear(); });
describe("public customize API", () => {
  it("is safe to import and check without a native module or supported platform", async () => {
    for (const os of ["ios", "web", "windows", "macos"]) {
      bridge.os = os; bridge.available = false;
      expect((await getCustomizeState()).enabled).toBe(false);
      onCustomizeState(() => { throw new Error("should not subscribe"); }).remove();
      await expect(showEditor()).rejects.toMatchObject({ code: os === "macos" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM" });
    }
    expect(bridge.call).not.toHaveBeenCalled();
  });
  it("lets ordinary application commands configure and generate with an installed CLI", async () => {
    const provider = { kind: "cli" as const, tool: "codex" as const };
    await configureCustomize(provider);
    expect(JSON.parse(bridge.call.mock.calls[0]![1])).toEqual({ provider });
    bridge.call.mockResolvedValue(JSON.stringify({ candidate: "abc", status: "needs-review", summary: "Blue", changedFiles: ["App.tsx"] }));
    expect((await generateEdit("Make it blue", { provider, allowSourceSharing: true })).candidate).toBe("abc");
    expect(bridge.call.mock.calls[1]![0]).toBe("customize.prompt");
    expect(JSON.parse(bridge.call.mock.calls[1]![1])).toEqual({ prompt: "Make it blue", provider, allowSourceSharing: true });
  });
  it("supports every review, activation, recovery and migration action without a mounted component", async () => {
    bridge.call.mockImplementation((method: string) => Promise.resolve(JSON.stringify(method === "customize.state" ? state : method === "customize.review" ? { text: "Patch", prompts: [] } : method === "customize.migrate" ? { status: "none", conflicts: [] } : null)));
    await showEditor(); await getCustomizeState(); await getEditReview(); await prepareEditMigration(); await previewEdit(); await applyEdit(); await restoreOriginal(); await cancelEdit();
    expect(bridge.call.mock.calls.map(call => call[0])).toEqual(["customize.show", "customize.state", "customize.review", "customize.migrate", "customize.preview", "customize.apply", "customize.original", "customize.cancel"]);
    bridge.call.mockRejectedValue(Object.assign(new Error("busy"), { code: "E_BUSY" }));
    await expect(applyEdit()).rejects.toMatchObject({ code: "E_BUSY" });
  });
  it("delivers progress and removes only the caller's listener", () => {
    const one = vi.fn(), two = vi.fn(); const a = onCustomizeState(one), b = onCustomizeState(two);
    for (const listener of bridge.listeners) listener({ type: "activate" });
    for (const listener of bridge.listeners) listener({ type: "customizeState", state });
    expect(one).toHaveBeenCalledExactlyOnceWith(state); expect(two).toHaveBeenCalledExactlyOnceWith(state);
    a.remove(); a.remove();
    for (const listener of bridge.listeners) listener({ type: "customizeState", state });
    expect(one).toHaveBeenCalledTimes(1); expect(two).toHaveBeenCalledTimes(2); b.remove();
    expect(bridge.listeners.size).toBe(0);
  });
  it("exposes device authorization and submission without returning a token", async () => {
    bridge.call.mockResolvedValueOnce(JSON.stringify({ userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresIn: 900 }));
    expect((await beginCustomizeGitHubAuth()).userCode).toBe("ABCD-EFGH");
    await completeCustomizeGitHubAuth(); await signOutCustomizeGitHub();
    bridge.call.mockResolvedValueOnce(JSON.stringify({ url: "https://github.com/owner/app/pull/3", number: 3, repository: "owner/app", branch: "spark-customize-id" }));
    expect((await submitEditPullRequest({ title: "Blue greeting" })).number).toBe(3);
    expect(bridge.call.mock.calls.map(call => call[0])).toEqual(["customize.githubBegin", "customize.githubComplete", "customize.githubSignOut", "customize.submitPR"]);
    await expect(submitEditPullRequest({ title: "" })).rejects.toMatchObject({ name: "SparkError", code: "E_INVALID_ARGUMENT" });
    await expect(submitEditPullRequest({ title: "Okay", unknown: undefined } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  });
  it("rejects malformed native responses and ignores malformed state events", async () => {
    bridge.call.mockResolvedValue("{}"); await expect(getCustomizeState()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
    bridge.call.mockResolvedValue("invalid"); await expect(getEditReview()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
    const listener = vi.fn(), subscription = onCustomizeState(listener);
    for (const callback of bridge.listeners) callback({ type: "customizeState", state: { enabled: true } });
    expect(listener).not.toHaveBeenCalled(); subscription.remove();
  });
  it("validates prompts and unknown options before serialization, including undefined keys", async () => {
    await expect(generateEdit(" ")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(generateEdit("Blue", { extra: undefined } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
    await expect(configureCustomize({ kind: "cli", tool: "codex", extra: undefined } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
    expect(bridge.call).not.toHaveBeenCalled();
  });
});
