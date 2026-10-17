import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/apple-authentication and /passkeys against a mocked bridge: validation, wire shapes, results versus
// typed errors, abort and availability.
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
let availabilityAnswer = "available";
const availabilityCalls: any[] = [];
const platform = { OS: "macos" };
const module = {
  call: (method: string, args: string) => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(reply(method, JSON.parse(args)))); },
  availability: (args: string) => { availabilityCalls.push(JSON.parse(args)); return availabilityAnswer; },
};
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: () => module } }));
vi.doMock("react-native/Libraries/Utilities/codegenNativeComponent", () => ({ default: (name: string) => name }));
const apple = await import("../packages/authentication/src/apple.ts");
const passkeys = await import("../packages/authentication/src/passkeys.ts");
const { SparkError } = await import("../packages/desktop-app/src/contracts/index.ts");
beforeEach(() => { platform.OS = "macos"; reply = () => null; availabilityAnswer = "available"; calls.length = 0; availabilityCalls.length = 0; });

const CHALLENGE = "YSBjaGFsbGVuZ2UgZnJvbSB0aGUgc2VydmVy"; // 27 bytes
const REGISTRATION = { relyingPartyId: "example.com", challenge: CHALLENGE, userId: "dXNlci0x", userName: "ada@example.com" };
const CREDENTIAL = { user: "001.u", state: "s", authorizedScopes: ["email"], identityToken: "t", authorizationCode: "c", email: "a@b.c", fullName: null, realUserStatus: "unknown" };

test("availability is truthful per platform and entitlement; unsupported calls reject after validation", async () => {
  expect(apple.getAppleAuthenticationAvailability()).toEqual({ available: true });
  expect(passkeys.getPasskeyAvailability("example.com")).toEqual({ available: true });
  expect(availabilityCalls).toEqual([{ feature: "appleId" }, { feature: "passkeys", relyingPartyId: "example.com" }]);
  availabilityAnswer = "missing-entitlement";
  expect(apple.getAppleAuthenticationAvailability()).toEqual({ available: false, reason: "missing-entitlement" });
  expect(passkeys.getPasskeyAvailability("example.com")).toEqual({ available: false, reason: "missing-entitlement" });
  availabilityAnswer = "maybe";
  expect(() => apple.getAppleAuthenticationAvailability()).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
  expect(() => passkeys.getPasskeyAvailability("https://example.com")).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  platform.OS = "windows";
  expect(apple.getAppleAuthenticationAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  expect(passkeys.getPasskeyAvailability("example.com")).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(apple.signInWithApple()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(apple.getAppleIDCredentialState("001.u")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(passkeys.createPasskey(REGISTRATION)).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(passkeys.getPasskey({ relyingPartyId: "example.com", challenge: CHALLENGE })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(apple.signInWithApple({ scopes: ["phone" as never] })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toEqual([]);
});

test("Sign in with Apple sends its request and validates the credential", async () => {
  reply = () => ({ type: "success", credential: CREDENTIAL });
  expect(await apple.signInWithApple({ scopes: ["email"], state: "s", nonce: "n", windowId: "main" })).toEqual({ type: "success", credential: CREDENTIAL });
  expect(calls[0]).toEqual({ method: "perform", args: { id: expect.any(String), operation: "appleId", scopes: ["email"], state: "s", nonce: "n", windowId: "main" } });
  await apple.signInWithApple();
  expect(calls[1]!.args).toEqual({ id: expect.any(String), operation: "appleId", scopes: [] });
  expect(calls[0]!.args.id).not.toBe(calls[1]!.args.id);
  reply = () => ({ type: "cancel" });
  expect(await apple.signInWithApple()).toEqual({ type: "cancel" });
  for (const credential of [{ ...CREDENTIAL, realUserStatus: "real" }, { ...CREDENTIAL, authorizedScopes: ["phone"] }, { ...CREDENTIAL, fullName: { givenName: 1 } }, { ...CREDENTIAL, user: null }]) {
    reply = () => ({ type: "success", credential });
    await expect(apple.signInWithApple()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
});

test("options are validated before native", async () => {
  const invalidApple = [{ scopes: ["email", "email"] }, { scopes: "email" }, { state: "" }, { nonce: "x".repeat(1025) }, { windowId: "a b" }, { signal: {} }, null];
  for (const options of invalidApple) await expect(apple.signInWithApple(options as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(apple.signInWithApple({ prompt: "login" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  const invalidCreate = [{ relyingPartyId: "Example.com" }, { relyingPartyId: "localhost" }, { challenge: "c2hvcnQ" }, { challenge: "YQ==" + "a".repeat(20) }, { userId: "" },
    { userId: "a".repeat(88) }, { userName: " " }, { displayName: "" }, { attestation: "self" }, { userVerification: "always" }, { excludeCredentials: ["a+b"] }, { excludeCredentials: "id" }];
  for (const change of invalidCreate) await expect(passkeys.createPasskey({ ...REGISTRATION, ...change } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(passkeys.createPasskey({ ...REGISTRATION, residentKey: "required" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(passkeys.getPasskey({ relyingPartyId: "example.com", challenge: CHALLENGE, allowCredentials: Array(65).fill("aWQ") })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(passkeys.getPasskey({ relyingPartyId: "example.com", challenge: CHALLENGE, userName: "ada" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(apple.getAppleIDCredentialState("")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toEqual([]);
});

test("passkeys send WebAuthn's base64url values and validate the responses", async () => {
  const registration = { credentialId: "Y3JlZA", clientDataJSON: "e30", attestationObject: null, authenticatorAttachment: "platform", transports: null, extensions: {} };
  reply = () => ({ type: "success", credential: registration });
  expect(await passkeys.createPasskey({ ...REGISTRATION, displayName: "Ada", attestation: "direct", userVerification: "required", excludeCredentials: ["b2xk"] })).toEqual({ type: "success", credential: registration });
  expect(calls[0]!.args).toEqual({ id: expect.any(String), operation: "createPasskey", ...REGISTRATION, displayName: "Ada", attestation: "direct", userVerification: "required", excludeCredentials: ["b2xk"] });
  const assertion = { credentialId: "Y3JlZA", userId: "dXNlci0x", clientDataJSON: "e30", authenticatorData: "YXV0aA", signature: "c2ln", authenticatorAttachment: "platform", extensions: {} };
  reply = () => ({ type: "success", credential: assertion });
  expect(await passkeys.getPasskey({ relyingPartyId: "example.com", challenge: CHALLENGE, allowCredentials: ["Y3JlZA"] })).toEqual({ type: "success", credential: assertion });
  expect(calls[1]!.args).toEqual({ id: expect.any(String), operation: "getPasskey", relyingPartyId: "example.com", challenge: CHALLENGE, allowCredentials: ["Y3JlZA"] });
  reply = () => ({ type: "success", credential: { ...assertion, signature: "c2ln==" } });
  await expect(passkeys.getPasskey({ relyingPartyId: "example.com", challenge: CHALLENGE })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  reply = () => ({ type: "success", credential: registration });
  await expect(passkeys.getPasskey({ relyingPartyId: "example.com", challenge: CHALLENGE })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  for (const credential of [{ ...assertion, authenticatorAttachment: "hybrid" }, { ...assertion, extensions: { prf: { results: { first: "a=" } } } }, { ...assertion, extensions: undefined }]) {
    reply = () => ({ type: "success", credential });
    await expect(passkeys.getPasskey({ relyingPartyId: "example.com", challenge: CHALLENGE })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  for (const credential of [{ ...registration, transports: ["hybrid"] }, { ...registration, extensions: { largeBlob: { supported: "yes" } } }]) {
    reply = () => ({ type: "success", credential });
    await expect(passkeys.createPasskey(REGISTRATION)).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
});

const ASSERTION = { relyingPartyId: "example.com", challenge: CHALLENGE };
const ASSERTED = { credentialId: "a2V5", userId: "dXNlci0x", clientDataJSON: "e30", authenticatorData: "YXV0aA", signature: "c2ln", authenticatorAttachment: "cross-platform", extensions: {} };

test("feature availability: host-restriction before the entitlement, unknown features rejected", () => {
  availabilityAnswer = "host-restriction";
  expect(passkeys.getPasskeyAvailability("example.com", "signals")).toEqual({ available: false, reason: "host-restriction" });
  expect(availabilityCalls.at(-1)).toEqual({ feature: "passkeys", relyingPartyId: "example.com", passkeyFeature: "signals" });
  availabilityAnswer = "available";
  for (const feature of ["securityKeys", "prf", "securityKeyPrf", "largeBlob", "signals"] as const) expect(passkeys.getPasskeyAvailability("example.com", feature)).toEqual({ available: true });
  expect(() => passkeys.getPasskeyAvailability("example.com", "hybrid" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  platform.OS = "windows";
  expect(passkeys.getPasskeyAvailability("example.com", "prf")).toEqual({ available: false, reason: "unsupported-platform" });
});

test("security keys, extensions and immediate requests reach native in WebAuthn's shapes", async () => {
  reply = () => ({ type: "success", credential: { credentialId: "a2V5", clientDataJSON: "e30", attestationObject: "YXR0", authenticatorAttachment: "cross-platform", transports: ["usb", "nfc"], extensions: { prf: { enabled: true } } } });
  expect(await passkeys.createPasskey({ ...REGISTRATION, authenticatorAttachment: "cross-platform", excludeCredentials: [{ id: "b2xk", transports: ["usb"] }], extensions: { prf: {} } }))
    .toMatchObject({ type: "success", credential: { authenticatorAttachment: "cross-platform", transports: ["usb", "nfc"], extensions: { prf: { enabled: true } } } });
  expect(calls[0]!.args).toEqual({ id: expect.any(String), operation: "createPasskey", ...REGISTRATION, authenticatorAttachment: "cross-platform", excludeCredentials: [{ id: "b2xk", transports: ["usb"] }], extensions: { prf: {} } });
  reply = () => ({ type: "success", credential: { ...ASSERTED, authenticatorAttachment: "platform", extensions: { prf: { results: { first: "b3V0" } }, largeBlob: { blob: "YmxvYg", written: false } } } });
  const extensions = { prf: { eval: { first: "c2FsdA" }, evalByCredential: { a2V5: { first: "c2FsdA", second: "dHdv" } } }, largeBlob: { read: true as const } };
  expect(await passkeys.getPasskey({ ...ASSERTION, allowCredentials: ["a2V5"], extensions, preferImmediatelyAvailableCredentials: true }))
    .toMatchObject({ type: "success", credential: { extensions: { prf: { results: { first: "b3V0" } }, largeBlob: { blob: "YmxvYg", written: false } } } });
  expect(calls[1]!.args).toEqual({ id: expect.any(String), operation: "getPasskey", ...ASSERTION, allowCredentials: ["a2V5"], extensions, preferImmediatelyAvailableCredentials: true });
  reply = () => ({ type: "success", credential: ASSERTED });
  await passkeys.getPasskey({ ...ASSERTION, authenticatorAttachment: "any", allowCredentials: [{ id: "a2V5", transports: ["ble"] }, "b2xk"] });
  expect(calls[2]!.args).toMatchObject({ authenticatorAttachment: "any", allowCredentials: [{ id: "a2V5", transports: ["ble"] }, "b2xk"] });
});

test("invalid or unsupported security key and extension options never reach native", async () => {
  const invalid = [{ authenticatorAttachment: "hybrid" }, { allowCredentials: [{ id: "a2V5", transports: ["usb"] }] }, { authenticatorAttachment: "cross-platform", allowCredentials: [{ id: "a2V5", transports: ["hybrid"] }] },
    { authenticatorAttachment: "any", allowCredentials: [{ id: "a2V5", transports: [] }] }, { allowCredentials: [{ transports: ["usb"] }] }, { extensions: { prf: {} } },
    { extensions: { prf: { eval: { first: "" } } } }, { extensions: { prf: { evalByCredential: { b3RoZXI: { first: "c2FsdA" } } } }, allowCredentials: ["a2V5"] },
    { extensions: { largeBlob: { read: false } } }, { extensions: { largeBlob: { read: true, write: "YQ" } } }, { extensions: { largeBlob: { write: "YQ" } } }, { preferImmediatelyAvailableCredentials: "yes" }];
  for (const change of invalid) await expect(passkeys.getPasskey({ ...ASSERTION, ...change } as never), JSON.stringify(change)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const unsupported = [{ extensions: { credProps: true } }, { extensions: { largeBlob: { read: true } }, authenticatorAttachment: "cross-platform" }, { extensions: { largeBlob: { read: true } }, authenticatorAttachment: "any" },
    { allowCredentials: [{ id: "a2V5", type: "public-key" }] }, { extensions: { prf: { eval: { first: "c2FsdA", third: "eA" } } } }];
  for (const change of unsupported) await expect(passkeys.getPasskey({ ...ASSERTION, ...change } as never), JSON.stringify(change)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(passkeys.createPasskey({ ...REGISTRATION, extensions: { largeBlob: { support: "required" } }, authenticatorAttachment: "cross-platform" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(passkeys.createPasskey({ ...REGISTRATION, extensions: { prf: { evalByCredential: {} } } } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(passkeys.createPasskey({ ...REGISTRATION, extensions: { largeBlob: { support: "always" } } } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(passkeys.createPasskey({ ...REGISTRATION, preferImmediatelyAvailableCredentials: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toEqual([]);
});

test("getCredential offers a passkey and Sign in with Apple in one request and reports which answered", async () => {
  reply = () => ({ type: "success", credential: CREDENTIAL });
  expect(await passkeys.getCredential({ passkey: ASSERTION, appleId: { scopes: ["email"] }, windowId: "main" })).toEqual({ type: "appleId", credential: CREDENTIAL });
  expect(calls[0]!.args).toEqual({ id: expect.any(String), operation: "getCredential", passkey: ASSERTION, appleId: { scopes: ["email"] }, windowId: "main" });
  reply = () => ({ type: "success", credential: ASSERTED });
  expect(await passkeys.getCredential({ passkey: { ...ASSERTION, authenticatorAttachment: "any" }, appleId: {}, preferImmediatelyAvailableCredentials: true })).toEqual({ type: "passkey", credential: ASSERTED });
  expect(calls[1]!.args).toMatchObject({ preferImmediatelyAvailableCredentials: true, appleId: { scopes: [] } });
  // A credential of a kind not asked for is invalid data.
  reply = () => ({ type: "success", credential: CREDENTIAL });
  await expect(passkeys.getCredential({ passkey: ASSERTION })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  reply = () => ({ type: "cancel" });
  expect(await passkeys.getCredential({ appleId: {} })).toEqual({ type: "cancel" });
  reply = () => ({ type: "failure", reason: "missingEntitlement", message: "no" });
  await expect(passkeys.getCredential({ passkey: ASSERTION, appleId: {} })).rejects.toMatchObject({ name: "AuthorizationError", code: "E_UNAVAILABLE", reason: "missingEntitlement" });
  const count = calls.length;
  await expect(passkeys.getCredential({})).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(passkeys.getCredential({ appleId: { scopes: ["phone" as never] } })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(passkeys.getCredential({ passkey: { ...ASSERTION, windowId: "main" } as never })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(passkeys.getCredential({ appleId: { signal: undefined } } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(passkeys.getCredential({ password: {} } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls.length).toBe(count);
});

test("signals send WebAuthn's values, resolve on success and reject failures", async () => {
  reply = () => null;
  await passkeys.signalUnknownCredential({ relyingPartyId: "example.com", credentialId: "a2V5" });
  await passkeys.signalAllAcceptedCredentials({ relyingPartyId: "example.com", userId: "dXNlci0x", allAcceptedCredentialIds: ["a2V5"] });
  await passkeys.signalCurrentUserDetails({ relyingPartyId: "example.com", userId: "dXNlci0x", name: "ada@example.org" });
  expect(calls).toEqual([
    { method: "signal", args: { kind: "unknownCredential", relyingPartyId: "example.com", credentialId: "a2V5" } },
    { method: "signal", args: { kind: "allAcceptedCredentials", relyingPartyId: "example.com", userId: "dXNlci0x", allAcceptedCredentialIds: ["a2V5"] } },
    { method: "signal", args: { kind: "currentUserDetails", relyingPartyId: "example.com", userId: "dXNlci0x", name: "ada@example.org" } }]);
  reply = () => ({ type: "failure", reason: "missingEntitlement", message: "no" });
  await expect(passkeys.signalUnknownCredential({ relyingPartyId: "example.com", credentialId: "a2V5" })).rejects.toMatchObject({ code: "E_UNAVAILABLE", reason: "missingEntitlement" });
  reply = () => ({ done: true });
  await expect(passkeys.signalUnknownCredential({ relyingPartyId: "example.com", credentialId: "a2V5" })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  calls.length = 0;
  await expect(passkeys.signalUnknownCredential({ relyingPartyId: "Example.com", credentialId: "a2V5" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(passkeys.signalAllAcceptedCredentials({ relyingPartyId: "example.com", userId: "dXNlci0x", allAcceptedCredentialIds: "a2V5" as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(passkeys.signalCurrentUserDetails({ relyingPartyId: "example.com", userId: "dXNlci0x", name: "Ada", displayName: "Ada" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  platform.OS = "windows";
  await expect(passkeys.signalUnknownCredential({ relyingPartyId: "example.com", credentialId: "a2V5" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  expect(calls).toEqual([]);
});

test("failures reject a typed AuthorizationError; unknown reasons are invalid data", async () => {
  const cases: [string, string][] = [["missingEntitlement", "E_UNAVAILABLE"], ["notInteractive", "E_UNAVAILABLE"], ["notHandled", "E_UNAVAILABLE"], ["failed", "E_UNAVAILABLE"],
    ["deviceNotConfigured", "E_UNAVAILABLE"], ["matchedExcludedCredential", "E_ALREADY_EXISTS"], ["invalidResponse", "E_INVALID_DATA"], ["appCancel", "E_ABORTED"], ["unknown", "E_NATIVE"]];
  for (const [reason, code] of cases) {
    reply = () => ({ type: "failure", reason, message: `Simulated ${reason}` });
    const error = await passkeys.createPasskey(REGISTRATION).catch(cause => cause);
    expect(error).toBeInstanceOf(passkeys.AuthorizationError);
    expect(error).toBeInstanceOf(SparkError);
    expect(error).toMatchObject({ code, reason, message: `Simulated ${reason}` });
  }
  expect(apple.AuthorizationError).toBe(passkeys.AuthorizationError);
  for (const reason of ["canceled", "toString", "constructor"]) {
    reply = () => ({ type: "failure", reason, message: "?" });
    await expect(apple.signInWithApple()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  reply = () => ({ type: "done" });
  await expect(apple.signInWithApple()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("credential state resolves Apple's answer or rejects its failure", async () => {
  for (const state of ["authorized", "revoked", "notFound", "transferred"]) {
    reply = () => state;
    expect(await apple.getAppleIDCredentialState("001.u")).toBe(state);
  }
  expect(calls.at(-1)).toEqual({ method: "credentialState", args: { user: "001.u" } });
  reply = () => ({ type: "failure", reason: "missingEntitlement", message: "no entitlement" });
  await expect(apple.getAppleIDCredentialState("001.u")).rejects.toMatchObject({ name: "AuthorizationError", code: "E_UNAVAILABLE", reason: "missingEntitlement" });
  reply = () => "gone";
  await expect(apple.getAppleIDCredentialState("001.u")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("native errors keep their Spark codes", async () => {
  for (const code of ["E_BUSY", "E_NOT_FOUND", "E_UNAVAILABLE", "E_INVALID_ARGUMENT"]) {
    module.call = () => Promise.reject(Object.assign(new Error(code), { code }));
    await expect(apple.signInWithApple()).rejects.toMatchObject({ code });
  }
  module.call = (method: string, args: string) => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(reply(method, JSON.parse(args)))); };
});

test("aborting cancels the pending request; an aborted signal never reaches native", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(apple.signInWithApple({ signal: controller.signal })).rejects.toMatchObject({ name: "AuthorizationError", code: "E_ABORTED", reason: "appCancel" });
  expect(calls).toEqual([]);
  let settle!: (value: unknown) => void;
  reply = method => method === "cancel" ? null : undefined;
  const pending = new AbortController();
  const original = module.call;
  module.call = (method: string, args: string) => {
    calls.push({ method, args: JSON.parse(args) });
    if (method === "cancel") { settle({ type: "failure", reason: "appCancel", message: "The app cancelled the request" }); return Promise.resolve("null"); }
    return new Promise(resolve => { settle = value => resolve(JSON.stringify(value)); });
  };
  const request = passkeys.getPasskey({ relyingPartyId: "example.com", challenge: CHALLENGE, signal: pending.signal });
  await Promise.resolve();
  pending.abort();
  await expect(request).rejects.toMatchObject({ code: "E_ABORTED", reason: "appCancel" });
  expect(calls.map(entry => entry.method)).toEqual(["perform", "cancel"]);
  expect(calls[1]!.args).toEqual({ id: calls[0]!.args.id });
  module.call = original;
});

type ButtonElement = { type: string; props: Record<string, any> };
const press = (element: ButtonElement, windowId = "main") => element.props.onButtonPress({ nativeEvent: { windowId } });

test("AppleSignInButton validates its props and renders Apple's button", () => {
  const onPress = vi.fn();
  const element = apple.AppleSignInButton({ onPress, testID: "b", style: { width: 200 } }) as unknown as ButtonElement;
  expect(element.type).toBe("DesktopAppleSignInButton");
  expect(element.props).toMatchObject({ testID: "b", buttonType: "signIn", buttonStyle: "automatic", cornerRadius: -1, style: [{ minWidth: 140, minHeight: 30 }, { width: 200 }] });
  expect((apple.AppleSignInButton({ onPress, buttonType: "signUp", buttonStyle: "whiteOutline", cornerRadius: 0 }) as unknown as ButtonElement).props)
    .toMatchObject({ buttonType: "signUp", buttonStyle: "whiteOutline", cornerRadius: 0 });
  press(element);
  press(element, "");
  expect(onPress.mock.calls).toEqual([[{ windowId: "main" }], [{ windowId: undefined }]]);
  const onSignIn = vi.fn(), onError = vi.fn();
  for (const props of [{ onPress, buttonType: "logIn" }, { onPress, buttonStyle: "blue" }, { onPress, cornerRadius: -1 }, { onPress, cornerRadius: Number.NaN }, {},
    { onSignIn }, { onError }, { onPress, onSignIn, onError }, { onPress, signInOptions: {} }, { onSignIn: "no", onError }])
    expect(() => apple.AppleSignInButton(props as never), JSON.stringify(props)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  platform.OS = "windows";
  expect(() => apple.AppleSignInButton({ onPress })).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  expect(calls).toEqual([]);
});

test("AppleSignInButton without onPress runs signInWithApple over its window and reports the outcome", async () => {
  const onSignIn = vi.fn(), onError = vi.fn();
  const element = apple.AppleSignInButton({ signInOptions: { scopes: ["email"], state: "s" }, onSignIn, onError }) as unknown as ButtonElement;
  reply = () => ({ type: "success", credential: CREDENTIAL });
  press(element);
  await vi.waitFor(() => expect(onSignIn).toHaveBeenCalledWith({ type: "success", credential: CREDENTIAL }));
  expect(calls[0]).toEqual({ method: "perform", args: { id: expect.any(String), operation: "appleId", scopes: ["email"], state: "s", windowId: "main" } });
  reply = () => ({ type: "failure", reason: "failed", message: "no" });
  press(element, "");
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNAVAILABLE", reason: "failed" })));
  expect(calls[1]!.args).not.toHaveProperty("windowId");
  // The app's windowId wins over the button's; invalid options reject through onError, never silently.
  press(apple.AppleSignInButton({ signInOptions: { windowId: "settings" }, onSignIn, onError }) as unknown as ButtonElement);
  await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
  expect(calls[2]!.args.windowId).toBe("settings");
  press(apple.AppleSignInButton({ signInOptions: { scopes: ["phone" as never] }, onSignIn, onError }) as unknown as ButtonElement);
  await vi.waitFor(() => expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ code: "E_INVALID_ARGUMENT" })));
  expect(onSignIn).toHaveBeenCalledTimes(1);
});
