import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { credentials, type Runner } from "../packages/cli/src/credentials.ts";
import { readJson, stateFile, writeJson } from "../packages/cli/src/project.ts";

const mocks = vi.hoisted(() => ({ question: vi.fn(), close: vi.fn(), spawn: vi.fn(), profiles: vi.fn() }));
vi.mock("../packages/cli/src/notary-profiles.ts", () => ({ listNotaryProfiles: mocks.profiles }));
vi.mock("node:readline/promises", () => ({ createInterface: () => ({ question: mocks.question, close: mocks.close }) }));
vi.mock("../packages/cli/src/process.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../packages/cli/src/process.ts")>(),
  spawnProcess: mocks.spawn,
}));

const identity = { hash: "A".repeat(40), name: "Developer ID Application: Test (ABCDEFGHIJ)", teamId: "ABCDEFGHIJ" };
const second = { hash: "B".repeat(40), name: "Developer ID Application: Other (OTHERTEAM1)", teamId: "OTHERTEAM1" };
const missing = new Error("xcrun notarytool history exited 69. No Keychain password item found for profile: Moo.do");
const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
let root: string;
let execute: ReturnType<typeof vi.fn<Runner>>;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "spark-credentials-"));
  writeJson(path.join(root, "app.json"), { expo: { name: "Test" } });
  for (const name of ["SPARK_SIGNING_KEYCHAIN", "SPARK_DEVELOPER_ID_APPLICATION", "SPARK_TEAM_ID", "SPARK_NOTARY_KEYCHAIN_PROFILE"]) vi.stubEnv(name, undefined);
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  mocks.question.mockReset();
  mocks.close.mockReset();
  mocks.spawn.mockReset().mockReturnValue({ exited: Promise.resolve(0) });
  mocks.profiles.mockReset().mockResolvedValue([]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  execute = vi.fn<Runner>().mockImplementation(async (_root, argv) => argv[0] === "security" ? `1) ${identity.hash} "${identity.name}"` : "{}");
});

afterEach(() => {
  if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

test("interactive setup lists certificates before offering existing or create profile choices", async () => {
  mocks.question.mockResolvedValueOnce("").mockResolvedValueOnce("1").mockResolvedValueOnce("existing");
  const result = await credentials(root, false, execute);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining(identity.name));
  expect(mocks.question.mock.calls.map(([question]) => question)).toEqual([
    "Signing certificate [1]: ", "Notarization profile [1]: ", "Existing notarization Keychain profile: ",
  ]);
  expect(result.keychainProfile).toBe("existing");
  expect(readJson(stateFile(root, "signing.json"))).toEqual(result);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("certificate selection determines the default name of an explicitly created profile", async () => {
  execute.mockResolvedValueOnce(`1) ${identity.hash} "${identity.name}"\n2) ${second.hash} "${second.name}"`);
  mocks.question.mockResolvedValueOnce("2").mockResolvedValueOnce("2").mockResolvedValueOnce("");
  const result = await credentials(root, false, execute);
  expect(result.hash).toBe(second.hash);
  expect(result.keychainProfile).toBe("spark-OTHERTEAM1");
  expect(mocks.spawn).toHaveBeenCalledWith(["xcrun", "notarytool", "store-credentials", "spark-OTHERTEAM1"], {
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  expect(execute.mock.calls.at(-1)?.[1]).toEqual(["xcrun", "notarytool", "history", "--keychain-profile", "spark-OTHERTEAM1", "--output-format", "json"]);
});

test("empty answers never select profile creation", async () => {
  mocks.question.mockResolvedValue("");
  await expect(credentials(root, false, execute)).rejects.toThrow("select the create option");
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(existsSync(stateFile(root, "signing.json"))).toBe(false);
});

test("remembered certificates remain the default without hiding other available certificates", async () => {
  writeJson(stateFile(root, "signing.json"), { ...second, keychainProfile: "existing" });
  execute.mockResolvedValueOnce(`1) ${identity.hash} "${identity.name}"\n2) ${second.hash} "${second.name}"`);
  mocks.profiles.mockResolvedValue(["existing"]);
  mocks.question.mockResolvedValue("");
  const result = await credentials(root, false, execute);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining(identity.name));
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining(second.name));
  expect(mocks.question).toHaveBeenCalledWith("Signing certificate [2]: ");
  expect(result.hash).toBe(second.hash);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("a missing entered profile returns to the menu without creating anything", async () => {
  mocks.question.mockResolvedValueOnce("").mockResolvedValueOnce("1").mockResolvedValueOnce("Moo.do")
    .mockResolvedValueOnce("1").mockResolvedValueOnce("working");
  execute.mockResolvedValueOnce(`1) ${identity.hash} "${identity.name}"`).mockRejectedValueOnce(missing);
  const result = await credentials(root, false, execute);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('profile "Moo.do" was not found'));
  expect(result.keychainProfile).toBe("working");
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.question.mock.calls.filter(([question]) => question === "Notarization profile [1]: ")).toHaveLength(2);
});

test("a saved profile can be created only through the explicit option, using the selected keychain", async () => {
  const keychain = "/tmp/signing.keychain-db";
  writeJson(stateFile(root, "signing.json"), { ...identity, keychainProfile: "Moo.do", keychain });
  mocks.question.mockResolvedValueOnce("").mockResolvedValueOnce("2").mockResolvedValueOnce("");
  const result = await credentials(root, false, execute);
  expect(mocks.profiles).toHaveBeenCalledWith(root, keychain, execute);
  expect(mocks.spawn).toHaveBeenCalledWith(["xcrun", "notarytool", "store-credentials", "Moo.do", "--keychain", keychain], {
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  expect(execute.mock.calls.at(-1)?.[1]).toContain(keychain);
  expect(readJson(stateFile(root, "signing.json"))).toEqual(result);
});

test("failed profile creation preserves saved selections and never claims success", async () => {
  const saved = { ...identity, keychainProfile: "Moo.do" };
  writeJson(stateFile(root, "signing.json"), saved);
  mocks.question.mockResolvedValueOnce("").mockResolvedValueOnce("2").mockResolvedValueOnce("replacement");
  mocks.spawn.mockReturnValue({ exited: Promise.resolve(1) });
  await expect(credentials(root, false, execute)).rejects.toThrow("credential setup failed");
  expect(readJson(stateFile(root, "signing.json"))).toEqual(saved);
  expect(execute).toHaveBeenCalledTimes(1);
});

test.each([true, false])("other notary failures propagate without offering creation (interactive: %s)", async interactive => {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: interactive });
  vi.stubEnv("SPARK_NOTARY_KEYCHAIN_PROFILE", "existing");
  mocks.profiles.mockResolvedValue(["existing"]);
  mocks.question.mockResolvedValue("");
  const failure = new Error("HTTP 401: invalid credentials");
  execute.mockResolvedValueOnce(`1) ${identity.hash} "${identity.name}"`).mockRejectedValueOnce(failure);
  await expect(credentials(root, false, execute)).rejects.toBe(failure);
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.question).toHaveBeenCalledTimes(interactive ? 2 : 0);
  expect(existsSync(stateFile(root, "signing.json"))).toBe(false);
});

test("noninteractive missing profile reports recovery without prompting or creating", async () => {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
  vi.stubEnv("SPARK_NOTARY_KEYCHAIN_PROFILE", "Moo.do");
  execute.mockResolvedValueOnce(`1) ${identity.hash} "${identity.name}"`).mockRejectedValueOnce(missing);
  await expect(credentials(root, false, execute)).rejects.toThrow("explicitly create one");
  expect(mocks.question).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.profiles).not.toHaveBeenCalled();
  expect(existsSync(stateFile(root, "signing.json"))).toBe(false);
});

test("saved notarization profiles are listed and selectable without entering a name", async () => {
  mocks.profiles.mockResolvedValue(["another", "Moo.do"]);
  mocks.question.mockResolvedValueOnce("").mockResolvedValueOnce("2");
  const result = await credentials(root, false, execute);
  expect(console.log).toHaveBeenCalledWith("1. another\n2. Moo.do");
  expect(console.log).toHaveBeenCalledWith("3. Enter an existing profile name\n4. Create a notarization Keychain profile");
  expect(result.keychainProfile).toBe("Moo.do");
  expect(mocks.question).toHaveBeenCalledTimes(2);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("remembered notarization profiles are the default and creation remains an explicit option", async () => {
  writeJson(stateFile(root, "signing.json"), { ...identity, keychainProfile: "remembered" });
  mocks.profiles.mockResolvedValue(["another", "remembered"]);
  mocks.question.mockResolvedValue("");
  const result = await credentials(root, false, execute);
  expect(mocks.question).toHaveBeenCalledWith("Notarization profile [2]: ");
  expect(result.keychainProfile).toBe("remembered");
  expect(mocks.spawn).not.toHaveBeenCalled();
});

test("profile discovery errors stop setup rather than presenting an empty list", async () => {
  mocks.question.mockResolvedValue("");
  const error = new Error("Keychain is locked");
  mocks.profiles.mockRejectedValue(error);
  await expect(credentials(root, false, execute)).rejects.toBe(error);
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(existsSync(stateFile(root, "signing.json"))).toBe(false);
});
