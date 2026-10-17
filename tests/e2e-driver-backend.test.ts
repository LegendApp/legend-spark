import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { DriverError, type MotionState } from "../scripts/e2e/driver.ts";
import { runFlows } from "../scripts/e2e/runner/executor.ts";
import { DriverBackend } from "../scripts/e2e/runner/driver-backend.ts";
import { COMMITS, COUNTERS, FakeApp, fakeMotion, fakeSamples, FRAME, FRAMES, REST_VALUES, STARTUP } from "./e2e-driver-fake.ts";
import { VirtualClock } from "./e2e-runner-backend.ts";

const HEADER = "appId: so.legend.spark.examples.kitchensink\nname: Driver flow\nintent: The test intent.\n";

async function run(commands: string, app = new FakeApp(), header = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-driver-"));
  mkdirSync(path.join(dir, "flows/area"), { recursive: true });
  writeFileSync(path.join(dir, "flows/area/test.yaml"), `${HEADER}${header}---\n${commands}`);
  const results = await runFlows([path.join(dir, "flows/area/test.yaml")], { backends: [new DriverBackend(app)], runDir: path.join(dir, "run"), clock: new VirtualClock() });
  return { results, result: results[0]!, app, dir };
}

describe("command mapping", () => {
  test("launchApp launches with the matrix locale, applies the matrix appearance, and delivers openUrl with navigate", async () => {
    const { results, app } = await run('- launchApp: { openUrl: "spark-ks://native-controls/buttons" }', new FakeApp(), "matrix:\n  appearance: [light, dark]\n  locale: [ar]\n");
    expect(results.map(result => result.status)).toEqual(["passed", "passed"]);
    expect(app.log).toEqual([
      "open", "launch locale=ar log=app-1.log", "setAppAppearance light 30000", "navigate spark-ks://native-controls/buttons", "quit", "close", "app close",
      "open", "launch locale=ar log=app-1.log", "setAppAppearance dark 30000", "navigate spark-ks://native-controls/buttons", "quit", "close", "app close",
    ]);
  });

  test("launchApp restarts a running app; with stopApp: false it only delivers the URL", async () => {
    const { result, app } = await run('- launchApp\n- launchApp: { openUrl: "spark-ks://a/b", stopApp: false }\n- launchApp: { stopApp: true }\n- stopApp');
    expect(result.status).toBe("passed");
    expect(app.log).toEqual(["open", "launch locale=- log=app-1.log", "navigate spark-ks://a/b", "quit", "close", "launch locale=- log=app-2.log", "quit", "close", "app close"]);
  });

  test("clearState deletes the app's state after the running app quits and before the next launch", async () => {
    const { result, app, dir } = await run("- launchApp: { clearState: true }\n- launchApp: { clearState: true }\n- launchApp: { clearState: false }");
    expect(result.status).toBe("passed");
    const logs = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(file => path.basename(file).startsWith("clear-state-")).sort();
    expect(logs.map(file => path.basename(file))).toEqual(["clear-state-1.log", "clear-state-2.log"]);
    expect(readFileSync(path.join(dir, logs[0]!), "utf8")).toBe("defaults:so.legend.spark.examples.kitchensink\n");
    expect(app.log).toEqual([
      "open", "clearState", "launch locale=- log=app-1.log", "quit", "close", "clearState", "launch locale=- log=app-2.log", "quit", "close",
      "launch locale=- log=app-3.log", "quit", "close", "app close",
    ]);
  });

  test("arguments follow the driver's own and env is passed through, per launch", async () => {
    const { result, app } = await run('- launchApp: { arguments: ["--spark-safe-mode", "-AppleLanguages", "(fr)"], env: { KS_MODE: "a b" } }\n- launchApp');
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("launch"))).toEqual(['launch locale=- args=--spark-safe-mode -AppleLanguages (fr) env={"KS_MODE":"a b"} log=app-1.log', "launch locale=- log=app-2.log"]);
  });

  test("openFile is delivered after openUrl, once the app runs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-driver-file-")), file = path.join(dir, "notes.md");
    writeFileSync(file, "# Notes");
    const { result, app } = await run(`- launchApp: { openUrl: "spark-ks://a/b", openFile: "${file}" }\n- launchApp: { openFile: "${file}", stopApp: false }`);
    expect(result.status).toBe("passed");
    expect(app.log).toEqual(["open", "launch locale=- log=app-1.log", "navigate spark-ks://a/b", `openFile ${file}`, `openFile ${file}`, "quit", "close", "app close"]);
  });

  test("selectors match the in-process accessibility view, one elements snapshot per poll", async () => {
    const { result, app } = await run("- launchApp\n- assertVisible: { id: root }\n- assertNotVisible: { id: gone }\n- extendedWaitUntil: { visible: { id: root } }", new FakeApp({ root: 3 }));
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line === "elements")).toHaveLength(5);
  });

  test("a missing testID is not-found after the command's timeout", async () => {
    const { result } = await run("- launchApp\n- assertVisible: { id: missing, timeout: 300ms }");
    expect(result.failure).toMatchObject({ kind: "not-found", message: 'no element matches {"id":"missing"} (waited 300ms on driver)' });
  });

  test("assertAppMenu checks the driver's menu snapshot by title path, and build: dev flows ask for the development bundle", async () => {
    const menuBar = [{ title: "Developer", enabled: true, hidden: false, state: "off" as const, items: [
      { title: "Reload", enabled: true, hidden: false, state: "off" as const },
      { separator: true as const },
      { title: "Open DevTools", enabled: false, hidden: false, state: "off" as const, toolTip: "Unavailable" },
      { title: "Show Developer Menu", enabled: true, hidden: true, state: "off" as const, shortcut: { key: "z", modifiers: (1 << 18) | (1 << 20) } },
    ] }];
    const passing = await run([
      "- launchApp", '- assertAppMenu: { path: "Developer > Reload", enabled: true }', '- assertAppMenu: { path: "Developer > Open DevTools", enabled: false, toolTip: Unavailable }',
      '- assertAppMenu: { path: "Developer > Show Developer Menu", hidden: true, shortcut: Ctrl+Cmd+Z }', '- assertAppMenu: { path: "Window > Minimize", exists: false }',
    ].join("\n"), new FakeApp({}, undefined, menuBar), "build: dev\n");
    expect(passing.result.status).toBe("passed");
    expect(passing.app.log[0]).toBe("open dev");
    const wrongState = await run('- launchApp\n- assertAppMenu: { path: "Developer > Open DevTools", enabled: true, timeout: 200ms }', new FakeApp({}, undefined, menuBar));
    expect(wrongState.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('expected enabled true, got false') });
    expect(wrongState.app.log[0]).toBe("open");
    const missing = await run('- launchApp\n- assertAppMenu: { path: "Developer > Inspect", timeout: 200ms }', new FakeApp({}, undefined, menuBar));
    expect(missing.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('"Inspect" is not in [Reload, Open DevTools, Show Developer Menu]') });
    const present = await run('- launchApp\n- assertAppMenu: { path: "Developer > Reload", exists: false, timeout: 200ms }', new FakeApp({}, undefined, menuBar));
    expect(present.result.failure).toMatchObject({ kind: "assertion", message: "menu item Developer > Reload exists" });
  });

  test("setClock and advanceClock drive the motion engine's virtual clock", async () => {
    const { result, app } = await run("- launchApp\n- setClock: virtual\n- advanceClock: 1.5s\n- advanceClock: 16\n- setClock: real");
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => /Clock/.test(line))).toEqual(["setClock virtual", "advanceClock 1500", "advanceClock 16", "setClock real"]);
  });

  test("simulateSystemEvent passes the event type and the state it implies to the driver", async () => {
    const { result, app } = await run("- launchApp\n- simulateSystemEvent: sleep\n- simulateSystemEvent: { type: thermalChanged, thermal: serious }");
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("simulateSystemEvent"))).toEqual(['simulateSystemEvent {"type":"sleep"}', 'simulateSystemEvent {"type":"thermalChanged","thermal":"serious"}']);
  });

  test("simulateDisplays replaces the reported displays and restore: true brings back the real ones", async () => {
    const display = '{ id: "7", persistentId: null, name: TV, primary: true, origin: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, safeArea: { top: 0, left: 0, bottom: 0, right: 0 }, refreshRate: { minimum: 60, maximum: 60, variable: false }, colorSpace: { name: null, gamut: srgb }, edrHeadroom: { current: 1, potential: 1, reference: null } }';
    const { result, app } = await run(`- launchApp\n- simulateDisplays: { displays: [${display}] }\n- simulateDisplays: { restore: true }`);
    expect(result.status).toBe("passed");
    const calls = app.log.filter(line => line.startsWith("simulateDisplays ")).map(line => JSON.parse(line.slice("simulateDisplays ".length)));
    expect(calls).toEqual([[expect.objectContaining({ id: "7", persistentId: null, colorSpace: { name: null, gamut: "srgb" }, edrHeadroom: { current: 1, potential: 1, reference: null } })], null]);
  });

  test("simulateGlobalShortcut presses a registered global shortcut by its parsed key and modifier flags", async () => {
    const { result, app } = await run("- launchApp\n- simulateGlobalShortcut: cmd+shift+space");
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("simulateGlobalShortcut"))).toEqual([`simulateGlobalShortcut ${JSON.stringify({ key: " ", modifiers: (1 << 20) | (1 << 17) })}`]);
  });

  test("setClipboard writes the app's test pasteboard; assertClipboard checks its types and text", async () => {
    const { result, app } = await run("- launchApp\n- setClipboard: { text: copied, html: \"<b>copied</b>\", concealed: true }\n- assertClipboard: { types: [public.html, org.nspasteboard.ConcealedType], text: copied }");
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.includes("Clipboard"))).toEqual(['setTestClipboard {"text":"copied","html":"<b>copied</b>","concealed":true}', "testClipboard"]);
    const failed = await run("- launchApp\n- setClipboard: { text: copied }\n- assertClipboard: { types: [public.html], text: other }");
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining("clipboard lacks public.html; it has [public.utf8-plain-text]") });
  });

  test("simulatePermission sets a kind's simulated state; assertSimulatedPermission checks it", async () => {
    const { result, app } = await run("- launchApp\n- simulatePermission: { kind: camera, authorization: denied, answer: allow }\n- simulatePermission: { kind: camera, answer: null }\n- assertSimulatedPermission: { kind: camera, authorization: denied, prompts: 0 }");
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.includes("Permission"))).toEqual(['simulatePermission {"kind":"camera","authorization":"denied","answer":"allow"}', 'simulatePermission {"kind":"camera","answer":null}', "testPermission camera"]);
    const failed = await run("- launchApp\n- assertSimulatedPermission: { kind: photos, authorization: authorized, timeout: 200ms }");
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('photos authorization is "notDetermined", expected "authorized"') });
  });

  test("simulateBiometrics sets the simulated state; assertSimulatedBiometrics checks prompts, the last prompt and secrets", async () => {
    const app = new FakeApp();
    app.biometrics = { biometryType: "touchId", biometrics: "available", password: "available", answer: null, pending: 0, prompts: 2, lastPrompt: { operation: "secret", reason: "Read the vault", fallback: "none" }, secrets: { vault: "biometryCurrentSet", pin: "biometryOrPassword" } };
    const { result } = await run("- launchApp\n- simulateBiometrics: { biometrics: lockout, answer: userCancel }\n- simulateBiometrics: { enrollmentChanged: true }\n- assertSimulatedBiometrics: { prompts: 2, pending: 0, lastOperation: secret, lastReason: Read the vault, lastFallback: none, secrets: { pin: biometryOrPassword } }", app);
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.includes("Biometrics"))).toEqual(['simulateBiometrics {"biometrics":"lockout","answer":"userCancel"}', 'simulateBiometrics {"enrollmentChanged":true}', "testBiometrics"]);
    expect(app.drivers[0]!.biometrics).toMatchObject({ biometrics: "lockout", answer: "userCancel" });
    const failed = await run("- launchApp\n- assertSimulatedBiometrics: { prompts: 1, timeout: 200ms }");
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining("biometrics prompts is 0, expected 1") });
  });

  test("simulateAuthorization sets the simulated state; assertSimulatedAuthorization checks requests, the last request and passkeys", async () => {
    const app = new FakeApp();
    app.authorization = { appleId: true, webCredentials: ["example.com"], answer: null, credentialState: null, choice: null, unavailableFeatures: [], requests: 2, pending: 0,
      lastRequest: { operation: "getCredential", window: "spark.main", offered: ["platform", "securityKey", "appleId"], extensions: ["prf"], preferImmediatelyAvailableCredentials: true, relyingPartyId: "example.com" },
      passkeys: [{ relyingPartyId: "example.com", credentialId: "aWQ", userName: "ada", authenticatorAttachment: "cross-platform" }], signals: [{ kind: "unknownCredential", relyingPartyId: "example.com" }] };
    const { result } = await run("- launchApp\n- simulateAuthorization: { appleId: false, answer: cancel }\n- simulateAuthorization: { webCredentials: [], credentialState: revoked, choice: appleId, unavailableFeatures: [signals] }\n- assertSimulatedAuthorization: { requests: 2, pending: 0, lastOperation: getCredential, lastWindow: spark.main, lastRelyingPartyId: example.com, passkeys: 1, lastOffered: [platform, securityKey, appleId], lastExtensions: [prf], lastImmediate: true, securityKeyPasskeys: 1, signals: 1, lastSignal: unknownCredential }", app);
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.includes("Authorization"))).toEqual(['simulateAuthorization {"appleId":false,"answer":"cancel"}', 'simulateAuthorization {"webCredentials":[],"credentialState":"revoked","choice":"appleId","unavailableFeatures":["signals"]}', "testAuthorization"]);
    expect(app.drivers[0]!.authorization).toMatchObject({ appleId: false, answer: "cancel", webCredentials: [], credentialState: "revoked", choice: "appleId", unavailableFeatures: ["signals"] });
    const offered = await run("- launchApp\n- assertSimulatedAuthorization: { lastOffered: [platform, appleId], timeout: 200ms }", app);
    expect(offered.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('authorization lastOffered is ["platform","securityKey","appleId"], expected ["platform","appleId"]') });
    const failed = await run("- launchApp\n- assertSimulatedAuthorization: { lastOperation: appleId, timeout: 200ms }");
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('authorization lastOperation is null, expected "appleId"') });
  });

  test("simulatePrivilegedHelper sets the simulated state; assertSimulatedPrivilegedHelper checks what reached it", async () => {
    const { result, app } = await run("- launchApp\n- simulatePrivilegedHelper: { signed: true, helpers: { tool: notRegistered }, promptAnswer: authorized }\n- simulatePrivilegedHelper: { helpers: { other: enabled }, connection: invalid }\n- assertSimulatedPrivilegedHelper: { registrations: 0, prompts: 0, messages: 0, helpers: { tool: notRegistered, other: enabled } }");
    expect(result.status).toBe("passed");
    expect(app.drivers[0]!.privilegedHelper).toMatchObject({ signed: true, promptAnswer: "authorized", connection: "invalid", helpers: { tool: "notRegistered", other: "enabled" } });
    expect(app.log.filter(line => line.includes("PrivilegedHelper"))).toEqual(['simulatePrivilegedHelper {"signed":true,"helpers":{"tool":"notRegistered"},"promptAnswer":"authorized"}', 'simulatePrivilegedHelper {"helpers":{"other":"enabled"},"connection":"invalid"}', "testPrivilegedHelper"]);
    const failed = await run("- launchApp\n- assertSimulatedPrivilegedHelper: { lastAuthorized: true, timeout: 200ms }");
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining("privileged helper lastAuthorized is null, expected true") });
    const status = await run("- launchApp\n- assertSimulatedPrivilegedHelper: { helpers: { tool: enabled }, timeout: 200ms }");
    expect(status.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('privileged helper tool is null, expected "enabled"') });
  });

  test("simulateSharing drives the sharing simulation; assertSharing checks what it recorded", async () => {
    const { result, app } = await run("- launchApp\n- simulateSharing: { shareAnswer: Mail, services: [Show] }\n- simulateSharing: { invokeService: { name: Show, text: hi } }\n- assertSharing: { shares: 0, invocations: 1, indexed: [], registered: [] }");
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.includes("Sharing"))).toEqual(['simulateSharing {"shareAnswer":"Mail","services":["Show"]}', 'simulateSharing {"invokeService":{"name":"Show","text":"hi"}}', "testSharing"]);
    const app2 = new FakeApp();
    app2.sharing.shares = [{ items: [{ type: "text", text: "Hi" }], anchored: true, service: "Mail" }];
    app2.sharing.indexed = { b: {}, a: {} };
    const passed = await run("- launchApp\n- assertSharing: { shares: 1, lastShare: { items: [{ text: Hi, type: text }], service: Mail }, indexed: [b, a] }", app2);
    expect(passed.result.status).toBe("passed");
    const failed = await run("- launchApp\n- assertSharing: { lastShare: { service: null }, timeout: 200ms }", app2);
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('the last share\'s service is "Mail", expected null') });
  });

  test("simulateSpeech sets the simulated speech state; assertSimulatedSpeech checks utterances and recognitions", async () => {
    const app = new FakeApp();
    const { result } = await run("- launchApp\n- simulateSpeech: { wordMs: 500, recognitionPartials: [hello], recognitionTranscript: hello world }\n- assertSimulatedSpeech: { utterances: 0, speaking: false, listening: false, recognitions: 0 }", app);
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.includes("Speech"))).toEqual(['simulateSpeech {"wordMs":500,"recognitionPartials":["hello"],"recognitionTranscript":"hello world"}', "testSpeech"]);
    expect(app.drivers[0]!.speech).toMatchObject({ wordMs: 500, recognitionTranscript: "hello world" });
    const failed = await run("- launchApp\n- assertSimulatedSpeech: { utterances: 1, timeout: 200ms }");
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining("speech utterances is 0, expected 1") });
  });

  test("simulateAppIntents drives the App Intents simulation; assertAppIntents checks what it recorded", async () => {
    const { result, app } = await run("- launchApp\n- simulateAppIntents: { intents: [{ id: show, title: Show, returnsText: true, parameters: [] }] }\n- simulateAppIntents: { invoke: { id: show, parameters: { n: 2 }, timeoutMs: 100 } }\n- assertAppIntents: { pending: 1, invocations: 0, registered: [] }");
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.includes("AppIntents"))).toEqual(['simulateAppIntents {"intents":[{"id":"show","title":"Show","returnsText":true,"parameters":[]}]}', 'simulateAppIntents {"invoke":{"id":"show","parameters":{"n":2},"timeoutMs":100}}', "testAppIntents"]);
    const app2 = new FakeApp();
    app2.appIntents.registered = ["b", "a"].sort();
    app2.appIntents.invocations = [{ id: "show", parameters: { n: 2 }, text: "Two" }, { id: "timer", parameters: {}, error: { code: "E_TIMEOUT", message: "late" } }];
    app2.appIntents.donations = [{ id: "show", parameters: { n: 1 } }];
    const passed = await run("- launchApp\n- assertAppIntents: { registered: [b, a], invocations: 2, lastInvocation: { id: timer, error: E_TIMEOUT, text: null }, donations: 1, lastDonation: { id: show, parameters: { n: 1 } } }", app2);
    expect(passed.result.status).toBe("passed");
    const failed = await run("- launchApp\n- assertAppIntents: { lastInvocation: { error: null }, timeout: 200ms }", app2);
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('the last invocation\'s error is "E_TIMEOUT", expected null') });
    // Entities: declared and queried through the simulation; a query is asserted by its kind and the ids it returned.
    const { result: queried, app: app3 } = await run("- launchApp\n- simulateAppIntents: { entities: [{ id: Note, title: Note }], query: { entity: Note, kind: search, text: gro, timeoutMs: 100 } }\n- assertAppIntents: { pending: 1, queries: 0 }");
    expect(queried.status).toBe("passed");
    expect(app3.log.filter(line => line.includes("AppIntents"))[0]).toBe('simulateAppIntents {"entities":[{"id":"Note","title":"Note"}],"query":{"entity":"Note","kind":"search","text":"gro","timeoutMs":100}}');
    app2.appIntents.registeredEntities = ["Note"];
    app2.appIntents.queries = [{ entity: "Note", query: { kind: "suggested" }, entities: [{ id: "a", title: "A" }, { id: "b", title: "B", subtitle: "S" }] }, { entity: "Note", query: { kind: "identifiers", identifiers: ["x"] }, error: { code: "E_NOT_FOUND", message: "No x" } }];
    expect((await run("- launchApp\n- assertAppIntents: { registeredEntities: [Note], queries: 2, lastQuery: { entity: Note, kind: identifiers, entities: null, error: E_NOT_FOUND } }", app2)).result.status).toBe("passed");
    app2.appIntents.queries.pop();
    expect((await run("- launchApp\n- assertAppIntents: { lastQuery: { kind: suggested, entities: [a, b], error: null } }", app2)).result.status).toBe("passed");
    const wrong = await run("- launchApp\n- assertAppIntents: { lastQuery: { entities: [b, a] }, timeout: 200ms }", app2);
    expect(wrong.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('the last query\'s entities is ["a","b"], expected ["b","a"]') });
  });

  test("simulateCapture sets the simulated devices; assertSimulatedCapture checks sessions, outputs and flowing frames", async () => {
    const app = new FakeApp();
    const { result } = await run("- launchApp\n- simulateCapture: { cameras: false }\n- assertSimulatedCapture: { cameras: false, microphones: true, cameraRunning: false, photos: 0, minFrames: 0 }", app);
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.includes("Capture"))).toEqual(['simulateCapture {"cameras":false}', "testCapture"]);
    expect(app.drivers[0]!.captureState).toMatchObject({ cameras: false, microphones: true });
    const failed = await run("- launchApp\n- assertSimulatedCapture: { minFrames: 3, timeout: 200ms }");
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining("capture frames is 0, expected at least 3") });
  });

  test("assertWebView checks a WebView's native inspectability and waits for it to mount", async () => {
    const app = new FakeApp();
    app.webViews = { web: { inspectable: false, url: "about:blank" } };
    expect((await run("- launchApp\n- assertWebView: { id: web, inspectable: false }", app)).result.status).toBe("passed");
    const inspectable = await run("- launchApp\n- assertWebView: { id: web, inspectable: true, timeout: 200ms }", app);
    expect(inspectable.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining("the WebView in web (about:blank) is not inspectable") });
    const missing = await run("- launchApp\n- assertWebView: { id: other, inspectable: false, timeout: 200ms }", app);
    expect(missing.result.failure).toMatchObject({ kind: "not-found", message: expect.stringContaining("No visible view with testID other") });
  });

  test("dragAndDrop runs a Spark drag source's drag in process: begin, move, a hold for spring loading, drop", async () => {
    const app = new FakeApp({ source: 1, target: 1 });
    app.dragSources = { source: {} };
    const started = Date.now();
    const { result } = await run("- launchApp\n- dragAndDrop: { from: { id: source }, to: { id: target }, modifiers: [alt], holdAt: 300ms }", app);
    expect(result.status).toBe("passed");
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(app.log.filter(line => line.startsWith("testDrag") || line.startsWith("drag "))).toEqual([
      'testDrag {"phase":"begin","from":"source","modifiers":["option"]}', 'testDrag {"phase":"move","to":"target","modifiers":["option"]}',
      'testDrag {"phase":"move","to":"target","modifiers":["option"]}', 'testDrag {"phase":"drop","modifiers":["option"]}']);
    // A source that refuses (its onError says why) drags nothing; steps cancels the started drag as unsupported.
    app.dragSources = { source: { refuse: true } };
    app.log.length = 0;
    expect((await run("- launchApp\n- dragAndDrop: { from: { id: source }, to: { id: target } }", app)).result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("testDrag"))).toEqual(['testDrag {"phase":"begin","from":"source"}']);
    app.dragSources = { source: {} };
    app.log.length = 0;
    expect((await run("- launchApp\n- dragAndDrop: { from: { id: source }, to: { id: target }, steps: 3 }", app)).result.failure).toMatchObject({ kind: "unsupported" });
    expect(app.log.filter(line => line.startsWith("testDrag")).at(-1)).toBe('testDrag {"phase":"cancel"}');
  });

  test("dragOut drags a Spark drag source by an offset over no destination and drops it there", async () => {
    const app = new FakeApp({ source: 1, plain: 1 });
    app.dragSources = { source: {} };
    expect((await run("- launchApp\n- dragOut: { from: { id: source }, by: \"-400,12.5\" }", app)).result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("testDrag"))).toEqual(['testDrag {"phase":"begin","from":"source"}', 'testDrag {"phase":"move","by":{"x":-400,"y":12.5}}', 'testDrag {"phase":"drop"}']);
    expect((await run("- launchApp\n- dragOut: { from: { id: plain }, by: \"10,10\" }", app)).result.failure).toMatchObject({ kind: "unsupported" });
    expect((await run("- launchApp\n- dragOut: { from: { id: source }, by: \"50%,10\" }", app)).result.failure).toMatchObject({ kind: "invalid" });
  });

  test("dragWindow drags a window by its title bar in process, holding it with release: false until the next dragWindow", async () => {
    const app = new FakeApp({ slot: 1, away: 1 });
    app.dropTargets = { slot: ["t1"] };
    const flow = "- launchApp\n- dragWindow: { window: { id: spark.main }, to: { id: slot }, release: false }\n- dragWindow: { window: { id: spark.main }, to: { id: away }, release: false }\n- dragWindow: { window: { id: spark.main }, to: { id: slot } }";
    expect((await run(flow, app)).result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("testWindowDrag"))).toEqual(['testWindowDrag {"phase":"begin","window":"spark.main"}', 'testWindowDrag {"phase":"move","to":"slot"}',
      'testWindowDrag {"phase":"move","to":"away"}', 'testWindowDrag {"phase":"move","to":"slot"}', 'testWindowDrag {"phase":"drop"}']);
    // A drag the flow still holds at its end is cancelled.
    app.log.length = 0;
    expect((await run("- launchApp\n- dragWindow: { window: { id: spark.main }, to: { id: slot }, release: false }", app)).result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("testWindowDrag")).at(-1)).toBe('testWindowDrag {"phase":"cancel"}');
  });

  test("dragToFinder drops a Spark drag in a private temporary folder and expects the promised file there", async () => {
    const app = new FakeApp({ source: 1, plain: 1 });
    app.dragSources = { source: { promised: ["Notes.txt"] } };
    const { result } = await run("- launchApp\n- dragToFinder: { from: { id: source }, expectFile: Notes.txt }", app);
    expect(result.status).toBe("passed");
    const drop = app.log.find(line => line.includes("dropInFolder"))!;
    const folder = JSON.parse(drop.slice("testDrag ".length)).folder as string;
    expect(folder.startsWith(path.join(tmpdir(), "spark-drop-"))).toBe(true);
    expect(existsSync(folder)).toBe(false); // removed after the flow
    expect((await run("- launchApp\n- dragToFinder: { from: { id: source }, expectFile: Other.txt }", app)).result.failure).toMatchObject({ kind: "assertion", message: "the drop wrote [Notes.txt], not Other.txt" });
    expect((await run("- launchApp\n- dragToFinder: { from: { id: plain }, expectFile: Notes.txt }", app)).result.failure).toMatchObject({ kind: "unsupported" });
    expect((await run("- launchApp\n- dragToFinder: { from: { id: source }, expectFile: ../Notes.txt }", app)).result.failure).toMatchObject({ kind: "invalid" });
  });

  test("setAppAppearance maps to the driver; takeScreenshot captures the main window into the flow's output", async () => {
    const { result, app } = await run("- launchApp\n- setAppAppearance: dark\n- takeScreenshot: shot");
    expect(result.status).toBe("passed");
    expect(app.log.slice(2, 4)).toEqual(["setAppAppearance dark undefined", "capture main capture-1"]);
    expect(result.artifacts).toEqual([{ kind: "screenshot", path: expect.stringMatching(/output\/shot\.png$/), backend: "driver" }]);
    expect(readFileSync(result.artifacts[0]!.path, "utf8")).toBe("png capture-1");
  });

  test("screenshot() reports the captured window in points from its top-left, the space waitFor frames use", async () => {
    const app = new FakeApp({ root: 1 }), backend = new DriverBackend(app), dir = mkdtempSync(path.join(tmpdir(), "e2e-driver-"));
    await backend.start({ flow: { header: { appId: "so.legend.spark.examples.kitchensink" } } as never, matrix: {}, platform: "macos", dir });
    await backend.commands.launchApp!({}, {} as never);
    expect(await backend.screenshot(path.join(dir, "a.png"))).toEqual({ frame: { x: 0, y: 0, width: 1000, height: 700 }, scale: 2, renderer: "layers" });
    // A window selector captures that window (takeScreenshot { window } evidence for a manualStep), not the main one.
    await backend.screenshot(path.join(dir, "b.png"), { id: "windows-window-options-child", title: "Child", key: false, main: false, frame: FRAME });
    expect(app.log.filter(line => line.startsWith("capture"))).toEqual(["capture main capture-1", "capture id:windows-window-options-child capture-2"]);
    expect(await backend.elements()).toEqual([{ key: "root", window: "spark.main", id: "root", frame: FRAME }]);
    expect(await backend.windows()).toEqual([{ id: "spark.main", title: "Kitchen Sink", key: false, main: true, frame: { x: 0, y: 0, width: 1000, height: 700 } }]);
    await backend.stop();
  });

  test("a failure collects the element tree, the app logs and a capture of the main window", async () => {
    const { result } = await run("- launchApp\n- assertVisible: { id: missing, timeout: 100ms }");
    expect(result.failure!.artifacts.map(artifact => [artifact.kind, path.basename(artifact.path), artifact.backend])).toEqual([
      ["elements", "elements-driver.json", "driver"], ["logs", "app-1.log", "driver"], ["screenshot", "driver-main.png", "driver"],
    ]);
    expect(existsSync(result.failure!.artifacts[2]!.path)).toBe(true);
  });
});

describe("preserveAppDefaults", () => {
  test("a timed-out flow still restores the snapshot, after quitting the app, though onFlowComplete cannot run", async () => {
    const { result, app } = await run(
      "- preserveAppDefaults: [AppleLanguages]\n- launchApp\n- assertVisible: { id: missing, timeout: 5s }",
      new FakeApp(), "timeout: 1s\nonFlowComplete:\n  - launchApp\n",
    );
    expect(result.failure).toMatchObject({ kind: "timeout", message: "the flow exceeded its 1000ms timeout" });
    expect(result.errors.join("\n")).toContain("onFlowComplete");
    // Polling (elements) and the failure capture aside.
    expect(app.log.filter(entry => entry !== "elements" && !entry.startsWith("capture "))).toEqual(["open", "preserve AppleLanguages", "launch locale=- log=app-1.log", "quit", "close", "restore AppleLanguages", "app close"]);
  });

  test("an interrupted run restores the snapshot too", async () => {
    const app = new FakeApp(), controller = new AbortController();
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-driver-"));
    mkdirSync(path.join(dir, "flows/area"), { recursive: true });
    writeFileSync(path.join(dir, "flows/area/test.yaml"), `${HEADER}---\n- preserveAppDefaults: { keys: [AppleLanguages, AppleLocale] }\n- launchApp\n- assertVisible: { id: missing, timeout: 5s }`);
    const clock = new VirtualClock(), sleep = clock.sleep.bind(clock);
    clock.sleep = async (ms: number) => { if (clock.now() > 500) controller.abort(); return sleep(ms); };
    const [result] = await runFlows([path.join(dir, "flows/area/test.yaml")], { backends: [new DriverBackend(app)], runDir: path.join(dir, "run"), clock, signal: controller.signal });
    expect(result!.failure).toMatchObject({ kind: "interrupted" });
    expect(app.log.slice(-2)).toEqual(["restore AppleLanguages,AppleLocale", "app close"]);
  });

  test("it refuses while the app runs, and changes nothing", async () => {
    const app = new FakeApp();
    app.refusePreserve = "preserveAppDefaults needs so.legend.spark.examples.kitchensink to be quit first";
    const refused = await run("- preserveAppDefaults: [AppleLanguages]\n- launchApp", app);
    expect(refused.result.failure).toMatchObject({ kind: "invalid", message: app.refusePreserve });
    expect(app.log).toEqual(["open", "app close"]);
    const late = await run("- launchApp\n- preserveAppDefaults: [AppleLanguages]");
    expect(late.result.failure).toMatchObject({ kind: "invalid", message: "preserveAppDefaults runs before launchApp: the app is running" });
  });
});

describe("white-box input (no black-box backend active)", () => {
  // FRAME is { x: 10, y: 20, width: 100, height: 40 }: its center is 60,40 in the main window.
  test.each([
    ["- tapOn: { id: save }", 'tap save+50,20 {}'],
    ["- doubleClickOn: { id: save }", 'tap save+50,20 {"clickCount":2}'],
    ["- tripleClickOn: { id: save }", 'tap save+50,20 {"clickCount":3}'],
    ["- rightClickOn: { id: save, modifiers: [cmd, alt] }", 'tap save+50,20 {"button":"right","modifiers":["cmd","option"]}'],
    ['- tapOn: { point: "25%,50%", within: { id: save } }', 'tap save+25,20 {}'],
    ["- hoverOn: { id: save }", "hover save+50,20"],
    ["- typeText: Hé😀", "typeText Hé😀"],
    ["- pressKey: Enter", 'pressKey "\\r" '],
    ["- pressKey: Up", 'pressKey "\uf700" '],
    ["- shortcut: cmd+shift+s", 'pressKey "s" cmd+shift'],
    ["- scroll: { on: { id: list }, direction: up, amount: 600, precise: true }", 'scroll list+50,20 {"deltaY":-600,"precise":true}'],
    ["- scroll: { on: { id: list }, direction: right }", 'scroll list+50,20 {"deltaX":3,"precise":false}'],
    ["- scroll: { on: { id: list } }", 'scroll list+50,20 {"deltaY":3,"precise":false}'],
    ["- swipe: { from: { id: list }, direction: up }", 'scroll list+50,20 {"deltaX":0,"deltaY":20,"precise":true}'],
    ['- swipe: { from: { id: list }, start: "50%,10%", end: "20%,90%" }', 'scroll list+50,20 {"deltaX":30,"deltaY":-32,"precise":true}'],
    ["- dragAndDrop: { from: { id: save }, to: { id: list }, steps: 20 }", 'drag save+50,20 list+50,20 {"steps":20}'],
    ["- mouseButton: { button: back, on: { id: save } }", 'tap save+50,20 {"button":"back"}'],
    ["- mouseButton: { button: forward, on: { id: save } }", 'tap save+50,20 {"button":"forward"}'],
    ["- forceClickOn: { id: save, modifiers: [shift] }", 'gesture save+50,20 {"kind":"pressure","stage":2} shift'],
    ["- smartZoomOn: { id: save }", 'gesture save+50,20 {"kind":"smartMagnify"}'],
    ["- pinch: { on: { id: list }, scale: 1.5 }", 'gesture list+50,20 {"kind":"magnify","magnification":0.5}'],
    ["- pinch: { on: { id: list }, scale: 0.5 }", 'gesture list+50,20 {"kind":"magnify","magnification":-0.5}'],
    ["- rotate: { on: { id: list }, degrees: 30 }", 'gesture list+50,20 {"kind":"rotate","rotation":-30}'],
    ["- swipe: { from: { id: list }, direction: left, fingers: 3 }", 'gesture list+50,20 {"kind":"swipe","direction":"left"}'],
  ])("%s", async (command, call) => {
    const { result, app } = await run(`- launchApp\n${command}`, new FakeApp({ save: 1, list: 1 }));
    expect(result.failure).toBeUndefined();
    expect(app.log.filter(line => /^(tap|hover|typeText|pressKey|scroll|drag|gesture) /.test(line))).toEqual([call]);
  });

  test("inputText and typeText click `into` first, then type", async () => {
    const { result, app } = await run('- launchApp\n- inputText: { text: " Shared!", into: { id: field } }', new FakeApp({ field: 1 }));
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => /^(tap|typeText) /.test(line))).toEqual(["tap field+50,20 {}", "typeText  Shared!"]);
  });

  test("steps the driver ran in place of a black-box backend are labelled white-box; lifecycle and driver commands are not", async () => {
    const { result } = await run("- launchApp\n- tapOn: { id: save }\n- assertVisible: { id: save }\n- setClock: virtual", new FakeApp({ save: 1 }));
    expect(result.steps.map(step => [step.command, step.whiteBox ?? false])).toEqual([["launchApp", false], ["tapOn", true], ["assertVisible", true], ["setClock", false]]);
    expect(result.whiteBox).toEqual(["assertVisible", "tapOn"]);
  });

  test("text, label, role and within select through the in-process accessibility view", async () => {
    const app = new FakeApp({ path: 1 });
    app.elements = [
      { key: "u", parent: "path", window: "spark.main", role: "button", text: "usr", frame: { x: 0, y: 0, width: 20, height: 10 } },
      { key: "b", window: "spark.main", role: "button", label: "Save", text: "Save", frame: { x: 100, y: 100, width: 40, height: 20 } },
    ];
    const { result } = await run("- launchApp\n- tapOn: { text: usr, within: { id: path } }\n- assertVisible: { role: button, label: Save }\n- tapOn: Save", app);
    expect(result.status).toBe("passed");
    // Elements without a testID are addressed by point in their window, without scrolling into view.
    expect(app.log.filter(line => line.startsWith("tap "))).toEqual(["tap 10,5@id:spark.main {}", "tap 120,110@id:spark.main {}"]);
  });

  test("assertText waits for the element's text; a mismatch is an assertion failure", async () => {
    const app = new FakeApp();
    let snapshots = 0;
    Object.defineProperty(app, "elements", { get: () => [{ key: "v", window: "spark.main", id: "value", text: ++snapshots < 3 ? "0" : "1", frame: FRAME }] });
    expect((await run("- launchApp\n- assertText: { id: value, equals: '1' }", app)).result.status).toBe("passed");
    expect(snapshots).toBe(3);
    const failed = await run("- launchApp\n- assertText: { id: value, equals: '2', timeout: 300ms }", app);
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: 'the text of {"id":"value"} is "1", not "2"' });
    expect((await run("- launchApp\n- assertText: { id: gone, equals: x, timeout: 100ms }", app)).result.failure).toMatchObject({ kind: "not-found" });
  });

  test("assertA11y checks the label, role, value, enabled and selected state NSAccessibility reports in-process", async () => {
    const app = new FakeApp();
    app.elements = [{ key: "d", window: "spark.main", id: "default", role: "button", label: "افتراضي", value: "5", enabled: false, selected: true, frame: FRAME }];
    expect((await run('- launchApp\n- assertA11y: { id: default, label: "افتراضي", role: button, value: "5", enabled: false, selected: true }\n- assertA11y: { id: default, label: "/^اف/" }', app)).result.status).toBe("passed");
    expect((await run("- launchApp\n- assertA11y: { id: default, enabled: true, timeout: 100ms }", app)).result.failure).toMatchObject({
      kind: "assertion", message: '{"id":"default"} reports enabled false, not true',
    });
    expect((await run("- launchApp\n- assertA11y: { id: default, label: Default, timeout: 100ms }", app)).result.failure).toMatchObject({
      kind: "assertion", message: 'the accessibility label of {"id":"default"} is "افتراضي", not "Default"',
    });
  });

  test("assertCursor moves onto `on` first, then waits for AppKit's cursor; hidden is the cursor hidden until the pointer moves", async () => {
    const app = new FakeApp({ link: 1 });
    let queries = 0;
    Object.defineProperty(app, "cursor", { get: () => ({ cursor: ++queries < 3 ? "arrow" : "pointingHand", hiddenUntilMoved: false }) });
    const { result } = await run("- launchApp\n- assertCursor: { cursor: pointingHand, on: { id: link } }", app);
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => /^(hover|cursor)/.test(line))).toEqual(["hover link+50,20", "cursor", "cursor", "cursor"]);
    const hidden = new FakeApp();
    hidden.cursor = { cursor: "IBeam", hiddenUntilMoved: true };
    expect((await run("- launchApp\n- assertCursor: hidden", hidden)).result.status).toBe("passed");
    expect((await run("- launchApp\n- assertCursor: { cursor: IBeam, timeout: 100ms }", hidden)).result.failure).toMatchObject({
      kind: "assertion", message: "the cursor is hidden (IBeam once the pointer moves), not IBeam",
    });
  });

  test("an element without a testID in a window without an identifier cannot be addressed", async () => {
    const app = new FakeApp();
    app.elements = [{ key: "x", window: "", text: "X", frame: FRAME }];
    expect((await run("- launchApp\n- tapOn: X", app)).result.failure).toMatchObject({
      kind: "unsupported", message: 'backend driver cannot address the window of "x": it has no identifier',
    });
  });
});

describe("motion and frames", () => {
  const motionApp = (motion = fakeMotion(), samples = fakeSamples([0, 60, 104, 98, 100]), clock: "virtual" | "real" = "virtual") => {
    const app = new FakeApp({ box: 1, go: 1 });
    app.motions = { box: { motion, samples, clock } };
    return app;
  };
  const motionLog = (app: FakeApp) => app.log.filter(line => /^(waitForMotion|sampleMotion|motionState|startFrames|stopFrames|tap|capture)/.test(line));

  test("captureMotion waits for the motion after the last input to settle and writes its samples", async () => {
    const { result, app } = await run("- launchApp\n- captureMotion: { target: { id: box }, name: open }\n- captureMotion: { target: { id: box }, until: 200ms, name: early }", motionApp());
    expect(result.status).toBe("passed");
    expect(motionLog(app)).toEqual([
      'waitForMotion box {"settled":true} 5000', 'sampleMotion box {"toMs":1400}', 'waitForMotion box {"elapsedMs":200} 5000', 'sampleMotion box {"toMs":1200}',
    ]);
    const output = result.artifacts.find(artifact => artifact.path.endsWith("open.motion.json"))!;
    const written = JSON.parse(readFileSync(output.path, "utf8"));
    expect(written).toMatchObject({ testID: "box", clock: "virtual", motion: { startMs: 1000, endMs: 1400 }, toMs: 1400 });
    expect(written.samples.map((sample: { values: { translateX: number } }) => sample.values.translateX)).toEqual([0, 60, 104, 98, 100]);
  });

  test("assertMotion checks kind, settle time and overshoot past the final value", async () => {
    const passing = await run("- launchApp\n- assertMotion: { target: { id: box }, kind: spring, settlesWithin: 400ms, overshoot: { min: 3px, max: 4.5 } }", motionApp());
    expect(passing.result.status).toBe("passed");
    expect(motionLog(passing.app)).toEqual(['waitForMotion box {"settled":true} 5000', 'sampleMotion box {"toMs":1400}']);
    const failing = await run("- launchApp\n- assertMotion: { target: { id: box }, kind: timing, settlesWithin: 300ms, overshoot: { max: 1px } }", motionApp());
    expect(failing.result.failure).toMatchObject({
      kind: "assertion",
      message: "the motion of box after the last input: it settled 400 ms after it started, not within 300ms; it is not a timing: it moved translateX spring; it overshot 4px, more than 1px",
    });
    const redirected = await run("- launchApp\n- assertMotion: { target: { id: box }, settlesWithin: 300ms }", motionApp(fakeMotion({ latestMs: 1100 })));
    expect(redirected.result.status).toBe("passed");  // 300 ms after its last interruption
    const late = await run("- launchApp\n- assertMotion: { target: { id: box }, settlesWithin: 200ms }", motionApp(fakeMotion({ latestMs: 1100 })));
    expect(late.result.failure?.message).toBe("the motion of box after the last input: it settled 300 ms after it was last interrupted, not within 200ms");
    const crossfade = await run("- launchApp\n- assertMotion: { target: { id: box }, kind: crossfade }", motionApp(fakeMotion({ properties: ["opacity"], kinds: { opacity: "timing" } })));
    expect(crossfade.result.status).toBe("passed");
    // A Reduce Motion alternate: the transform changes at once while opacity fades.
    const reduced = await run("- launchApp\n- assertMotion: { target: { id: box }, kind: crossfade }", motionApp(fakeMotion({ properties: ["opacity", "translateX"], kinds: { opacity: "timing", translateX: "jump" } })));
    expect(reduced.result.status).toBe("passed");
    const slid = await run("- launchApp\n- assertMotion: { target: { id: box }, kind: crossfade }", motionApp(fakeMotion({ properties: ["opacity", "translateX"], kinds: { opacity: "timing", translateX: "spring" } })));
    expect(slid.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining("it is not a crossfade: it moved opacity timing, translateX spring") });
    const still = await run("- launchApp\n- assertMotion: { target: { id: box }, overshoot: { min: 1px } }", motionApp(fakeMotion(), fakeSamples([0, 5, 0])));
    expect(still.result.failure).toMatchObject({ kind: "assertion", message: "the motion of box after the last input: overshoot is measured on a translation that travels; it moved translateX spring" });
  });

  test("velocityContinuous needs an interruption that kept value and velocity", async () => {
    const handoff = (after: { value: number; velocity: number }) => fakeMotion({ interruptions: [{ timeMs: 1100, property: "translateX", before: { value: 60, velocity: 60 }, after }] });
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, velocityContinuous: true }", motionApp(handoff({ value: 60, velocity: 60.00001 })))).result.status).toBe("passed");
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, velocityContinuous: true }", motionApp(handoff({ value: 60, velocity: 0 })))).result.failure).toMatchObject({
      kind: "assertion", message: "the motion of box after the last input: an interruption changed value or velocity: translateX 60 at 60/s → 60 at 0/s",
    });
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, velocityContinuous: true }", motionApp())).result.failure).toMatchObject({
      kind: "assertion", message: "the motion of box after the last input: it was never interrupted, so velocity continuity was not exercised",
    });
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, velocityContinuous: false }", motionApp(handoff({ value: 60, velocity: 0 })))).result.status).toBe("passed");
  });

  test("kind: none checks there is no motion after the last input without waiting", async () => {
    const quiet = new FakeApp({ box: 1 });
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, kind: none }", quiet)).result.status).toBe("passed");
    expect(motionLog(quiet)).toEqual(["motionState box"]);
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, kind: none }", motionApp())).result.failure).toMatchObject({ kind: "assertion", message: "box moved after the last input (translateX spring)" });
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, kind: none, settlesWithin: 1s }", motionApp())).result.failure).toMatchObject({ kind: "invalid" });
  });

  test("assertPaused hides the target's window, checks its animation holds still, and shows the window again", async () => {
    const values = (rotate: number) => ({ ...REST_VALUES, rotate });
    const pausing = (states: Partial<MotionState>[]) => { const app = motionApp(); app.motions.box!.states = states; return app; };
    const log = (app: FakeApp) => app.log.filter(line => /^(motionState|simulateOcclusion|advanceClock)/.test(line));
    const passing = pausing([
      { animating: ["rotate"], values: values(10) }, { animating: ["rotate"], paused: true, hidden: true, values: values(90) },
      { animating: ["rotate"], paused: true, hidden: true, values: values(90) }, { animating: ["rotate"], values: values(91) },
    ]);
    const passed = (await run("- launchApp\n- assertPaused: { target: { id: box }, when: windowHidden }", passing)).result;
    expect(passed.failure).toBeUndefined();
    expect(log(passing)).toEqual(["motionState box", "simulateOcclusion box false", "motionState box", "advanceClock 250", "motionState box", "simulateOcclusion box true", "motionState box"]);
    const finished = pausing([{ animating: ["translateX"] }, { hidden: true }, { hidden: true }, {}]);
    const failure = (await run("- launchApp\n- assertPaused: { target: { id: box }, when: occluded }", finished)).result.failure;
    expect(failure).toMatchObject({ kind: "assertion", message: "box with its window hidden: it finished instead of pausing; it did not resume when its window was shown again" });
    expect(log(finished).at(-2)).toBe("simulateOcclusion box true");
    const moving = pausing([{ animating: ["rotate"] }, { animating: ["rotate"], hidden: true, values: values(10) }, { animating: ["rotate"], hidden: true, values: values(40) }, { animating: ["rotate"] }]);
    expect((await run("- launchApp\n- assertPaused: { target: { id: box }, when: windowHidden }", moving)).result.failure).toMatchObject({
      kind: "assertion", message: "box with its window hidden: it kept animating while its window was hidden; it moved while hidden: rotate 10 → 40",
    });
    expect((await run("- launchApp\n- assertPaused: { target: { id: box }, when: windowHidden }", pausing([{}]))).result.failure).toMatchObject({ kind: "assertion", message: "box has no running animation to pause" });
    expect((await run("- launchApp\n- assertPaused: { target: { id: box }, when: minimized }", motionApp())).result.failure).toMatchObject({ kind: "unsupported" });
  });

  test("assertMotion frames advances the virtual clock to each progress point and compares every capture with its golden", async () => {
    const matrix = "matrix:\n  appearance: [light]\n  locale: [en]\n";
    const { result, app } = await run("- launchApp\n- assertMotion: { target: { id: box }, frames: { at: [100, 0, 12.5], golden: slide } }", motionApp(), matrix);
    expect(motionLog(app)).toEqual([
      "motionState box",
      'waitForMotion box {"progress":0} 5000', "capture main capture-1",
      'waitForMotion box {"progress":0.125} 5000', "capture main capture-2",
      'waitForMotion box {"progress":1} 5000', "capture main capture-3",
      "capture main capture-4", // failure evidence: no golden exists for any frame
    ]);
    expect(result.goldens.map(golden => golden.id)).toEqual(["macos/light/en/slide-0", "macos/light/en/slide-12_5", "macos/light/en/slide-100"]);
    expect(result.failure?.kind).toBe("assertion");
    expect(result.failure?.message.split("\n")).toHaveLength(3);
    const real = await run("- launchApp\n- assertMotion: { target: { id: box }, frames: { at: [50], golden: slide } }", motionApp(fakeMotion(), fakeSamples([0]), "real"));
    expect(real.result.failure).toMatchObject({ kind: "invalid", message: "assertMotion frames are exact frames of the virtual clock; run setClock: virtual before the motion starts" });
  });

  test("interruptAt waits for the progress point, then runs its command", async () => {
    const { result, app } = await run("- launchApp\n- interruptAt: { target: { id: box }, progress: 0.25, with: { tapOn: { id: go } } }", motionApp());
    expect(result.status).toBe("passed");
    expect(motionLog(app)).toEqual(['waitForMotion box {"progress":0.25} 5000', 'tap go+50,20 {}']);
    expect((await run("- launchApp\n- interruptAt: { progress: 0.25, with: { tapOn: { id: go } } }", motionApp())).result.failure).toMatchObject({ kind: "unsupported" });
  });

  test("motion that never starts, and targets without a testID, fail typed", async () => {
    expect((await run("- launchApp\n- captureMotion: { target: { id: go }, name: x }", motionApp())).result.failure).toMatchObject({
      kind: "timeout", message: "captureMotion: E_TIMEOUT: No motion of the view started or was interrupted after the last driver input",
    });
    const app = motionApp();
    app.elements = [{ key: "label", window: "spark.main", text: "Box", frame: FRAME }];
    expect((await run("- launchApp\n- assertMotion: { target: Box, kind: spring }", app)).result.failure).toMatchObject({ kind: "unsupported", message: 'backend driver reads motion by testID, and "Box" matched an element without one' });
    expect((await run("- launchApp\n- captureMotion: { target: { id: box }, name: ../x }", motionApp())).result.failure).toMatchObject({ kind: "invalid" });
  });

  test("assertFrames counts frames around its command and records the gate metrics", async () => {
    const { result, app } = await run("- launchApp\n- assertFrames: { during: { tapOn: { id: go } }, fps: { min: 110 }, dropped: 0 }", motionApp());
    expect(result.status).toBe("passed");
    expect(motionLog(app)).toEqual(["startFrames", "tap go+50,20 {}", "stopFrames"]);
    expect(result.metrics).toEqual({ "frames.fps": [120], "frames.dropped": [0] });
    // `for` keeps counting after the command, sending the app nothing until then.
    const started = performance.now();
    const held = await run("- launchApp\n- assertFrames: { during: { tapOn: { id: go } }, for: 300ms, dropped: 0 }", motionApp());
    expect(held.result.status).toBe("passed");
    expect(performance.now() - started).toBeGreaterThanOrEqual(300);
    expect(motionLog(held.app)).toEqual(["startFrames", "tap go+50,20 {}", "stopFrames"]);
    const dropping = motionApp();
    dropping.frames = { ...FRAMES, droppedFrames: 3, fps: 90, maxFrameGapMs: 33.4 };
    expect((await run("- launchApp\n- assertFrames: { during: { tapOn: { id: go } }, fps: { min: 110 }, dropped: 0 }", dropping)).result.failure).toMatchObject({
      kind: "assertion", message: "90 fps is below 110; 3 frames dropped, more than 0 (61 frames over 500 ms at 120 Hz; longest gap 33.4 ms)",
    });
    const blind = motionApp();
    blind.frames = new DriverError("E_UNAVAILABLE", "The display link delivered 1 frames, so frame timing could not be measured");
    expect((await run("- launchApp\n- assertFrames: { during: { tapOn: { id: go } }, dropped: 0 }", blind)).result.failure).toMatchObject({ kind: "unsupported" });
    const broken = motionApp();
    expect((await run("- launchApp\n- assertFrames: { during: { tapOn: { id: missing } }, dropped: 0 }", broken)).result.failure?.kind).toBe("not-found");
    expect(motionLog(broken).filter(line => !line.startsWith("capture")).at(-1)).toBe("stopFrames");
  });
  test("assertFrames with trace: true records the frame timeline and writes it as a Chrome trace artifact; without, it asks for none", async () => {
    const app = motionApp();
    app.frames = { ...FRAMES, timeline: { timestamps: [0, 8.3, 25], intervalMs: 8.333, motion: [{ view: "box", startMs: 0, endMs: 25 }], truncated: false } };
    const { result } = await run("- launchApp\n- assertFrames: { during: { tapOn: { id: go } }, dropped: 5, trace: true }", app);
    expect(result.status).toBe("passed");
    expect(motionLog(app)).toEqual(['startFrames {"timeline":true}', "tap go+50,20 {}", "stopFrames"]);
    const trace = result.artifacts.find(artifact => artifact.kind === "trace");
    expect(trace?.path).toMatch(/frames-1\.trace\.json$/);
    const events = JSON.parse(readFileSync(trace!.path, "utf8")).traceEvents as { name: string; tid: number; ph: string; dur?: number }[];
    expect(events.filter(event => event.ph === "X").map(event => [event.name, event.tid, event.dur])).toEqual([["Frame", 1, 8300], ["Dropped 1 frame", 1, 16700], ["box", 2, 25000]]);
    const plain = await run("- launchApp\n- assertFrames: { during: { tapOn: { id: go } }, dropped: 5 }", motionApp());
    expect(plain.result.artifacts.filter(artifact => artifact.kind === "trace")).toEqual([]);
  });
});

describe("app inspection", () => {
  const inspectLog = (app: FakeApp) => app.log.filter(line => /^(startup|state)/.test(line));

  test("assertStartup reads the launch's startup phases, records the gate metrics and checks the bounds", async () => {
    const { result, app } = await run("- launchApp\n- assertStartup: { coldMs: { max: 800 }, firstPaintMs: { min: 100, max: 600 } }");
    expect(result.status).toBe("passed");
    expect(result.metrics).toEqual({ "startup.coldMs": [690], "startup.firstPaintMs": [510] });
    // The first UI can take longer than a command's default wait; an explicit timeout wins.
    expect(inspectLog(app)).toEqual(["startup 30000"]);
    expect(inspectLog((await run("- launchApp\n- assertStartup: { coldMs: { max: 800 }, timeout: 2s }")).app)).toEqual(["startup 2000"]);
    // With `id`, the cold launch ends when that element first shows in a settled UI.
    const ready = await run("- launchApp\n- assertStartup: { id: catalog, coldMs: { max: 1000 } }");
    expect([ready.result.status, ready.result.metrics, inspectLog(ready.app)]).toEqual(["passed", { "startup.coldMs": [900], "startup.firstPaintMs": [510] }, ["startup 30000 catalog"]]);
    expect((await run("- launchApp\n- assertStartup: { coldMs: { max: 600 }, firstPaintMs: { min: 600 } }")).result.failure).toMatchObject({
      kind: "assertion", message: "coldMs 690 is above 600; firstPaintMs 510 is below 600 (willFinishLaunching 120 ms, didFinishLaunching 180 ms, bundleLoaded 420 ms, firstMount 510 ms, settled 690 ms)",
    });
    const unsettled = new FakeApp();
    unsettled.startup = new DriverError("E_TIMEOUT", "The first UI kept mounting changes until the timeout");
    const failed = await run("- launchApp\n- assertStartup: { coldMs: { max: 800 } }", unsettled);
    expect(failed.result.failure).toMatchObject({ kind: "timeout", message: "assertStartup: E_TIMEOUT: The first UI kept mounting changes until the timeout" });
    expect(failed.result.metrics).toEqual({});
    expect(STARTUP.settled).toBe(690);
  });

  test("assertState polls the exposed state until the JSON value at the path equals the expected one", async () => {
    const app = new FakeApp();
    let reads = 0;
    app.state = { get "documents.open.length"() { return ++reads < 3 ? 1 : 2; }, navigation: { kind: "screen", area: "infra", screen: "launch-state" } };
    const { result } = await run("- launchApp\n- assertState: { path: documents.open.length, equals: 2 }\n- assertState: { path: navigation, equals: { kind: screen, area: infra, screen: launch-state } }", app);
    expect(result.status).toBe("passed");
    expect(inspectLog(app)).toEqual(["state documents.open.length", "state documents.open.length", "state documents.open.length", "state navigation"]);
    expect((await run("- launchApp\n- assertState: { path: navigation, equals: { kind: catalog }, timeout: 200ms }", app)).result.failure).toMatchObject({
      kind: "assertion", message: 'state navigation is {"kind":"screen","area":"infra","screen":"launch-state"}, not {"kind":"catalog"}',
    });
    expect((await run("- launchApp\n- assertState: { path: nope, equals: 1, timeout: 200ms }", app)).result.failure).toMatchObject({ kind: "not-found", message: "assertState nope: E_NOT_FOUND: No test state at nope" });
  });

  test("assertCrashSymbol names a dev build's report in-process and needs the dSYMs next to a release build", async () => {
    const frame = (symbol?: string) => ({ address: "0x1004", image: "/tmp/clone/KitchenSink.app/Contents/MacOS/KitchenSink", imageAddress: "0x1000", imageOffset: 4, imageUUID: "0F2C0000-0000-0000-0000-000000000000", ...(symbol ? { symbol } : {}) });
    const app = new FakeApp();
    app.state = { "crash.report": { kind: "native", stack: [frame("SparkCrashNow"), frame("main")] }, "crash.stripped": { kind: "native", stack: [frame("_mh_execute_header")] }, "crash.none": null };
    const check = async (path: string, symbol = "SparkCrashNow") => (await run(`- launchApp\n- assertCrashSymbol: { path: ${path}, symbol: ${symbol} }`, app)).result;
    expect((await check("crash.report")).status).toBe("passed");
    // A dev build's assertion stays in-process: a report without the name fails, whatever symbols exist on disk.
    expect((await check("crash.stripped")).failure).toMatchObject({ kind: "assertion", message: "no frame of crash.stripped is named SparkCrashNow in-process (frames: _mh_execute_header)" });
    expect((await check("crash.report", "SparkCrashRecurse")).failure).toMatchObject({ kind: "assertion" });
    expect((await check("crash.none")).failure).toMatchObject({ kind: "assertion", message: "state crash.none is not a native crash report: null" });

    // A release build: symbolicated with <dir of the app>/dSYMs; without that folder it fails as "no dSYM".
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-crash-symbol-"));
    app.bundle = { app: path.join(dir, "KitchenSink.app"), release: true, sandboxed: false };
    expect((await check("crash.stripped")).failure).toMatchObject({ kind: "invalid", message: expect.stringMatching(/^no dSYM: .*KitchenSink\.app is a stripped release build with no dSYMs folder next to it/) });
    mkdirSync(path.join(dir, "dSYMs"));
    // An in-process name never counts for a release build; only what its dSYMs name. Here none covers the app's image.
    expect((await check("crash.report")).failure).toMatchObject({
      kind: "assertion",
      message: `no frame of crash.report is named SparkCrashNow after symbolicating with the dSYMs next to the app (frames: ?); no dSYM in ${path.join(dir, "dSYMs")} for KitchenSink (0F2C0000-0000-0000-0000-000000000000)`,
    });
  });
});

describe("layout, flicker, leaks and memory", () => {
  const renderLog = (app: FakeApp) => app.log.filter(line => /^(startCommits|stopCommits|counters|memory|tap)/.test(line));

  test("assertNoLayoutThrash and assertNoFlicker watch commits around their command until the UI settles", async () => {
    const { result, app } = await run("- launchApp\n- assertNoLayoutThrash: { during: { tapOn: { id: go } } }\n- assertNoFlicker: { during: { tapOn: { id: go } }, timeout: 2s }", new FakeApp({ go: 1 }));
    expect(result.status).toBe("passed");
    expect(renderLog(app)).toEqual(["startCommits", "tap go+50,20 {}", "stopCommits 5000", "startCommits", "tap go+50,20 {}", "stopCommits 2000"]);
    // A failing command still stops watching.
    const broken = await run("- launchApp\n- assertNoFlicker: { during: { tapOn: { id: missing, timeout: 100ms } } }", new FakeApp({ go: 1 }));
    expect(broken.result.failure?.kind).toBe("not-found");
    expect(renderLog(broken.app)).toEqual(["startCommits", "stopCommits undefined"]);
  });

  test("relayouts, gaps and blank windows fail with the views and elements, and the report as an artifact", async () => {
    const app = new FakeApp({ go: 1 });
    app.commits = { ...COMMITS, commits: 4,
      relayouts: [{ view: "RCTParagraphComponentView in row", window: "spark.main", changes: 2, frames: [{ x: 0, y: 0, width: 10, height: 20 }, { x: 0, y: 0, width: 12, height: 20 }, { x: 0, y: 0, width: 10, height: 20 }] }],
      gaps: [{ id: "row", window: "spark.main", commits: 1 }], blanks: [{ window: "spark.main", commits: 2 }] };
    const thrash = await run("- launchApp\n- assertNoLayoutThrash: { during: { tapOn: { id: go } } }", app);
    expect(thrash.result.failure).toMatchObject({ kind: "assertion", message: "1 views were laid out in more than one commit: RCTParagraphComponentView in row (spark.main) 0,0 10×20 → 0,0 12×20 → 0,0 10×20 (4 commits)" });
    const artifact = thrash.result.failure!.artifacts!.find(item => item.path.endsWith(".commits.json"))!;
    expect(JSON.parse(readFileSync(artifact.path, "utf8"))).toEqual(app.commits);
    expect((await run("- launchApp\n- assertNoFlicker: { during: { tapOn: { id: go } } }", app)).result.failure).toMatchObject({
      kind: "assertion", message: "elements disappeared and came back: row (spark.main) for 1 commit; windows showed no elements: spark.main for 2 commits (4 commits)",
    });
    const busy = new FakeApp({ go: 1 });
    busy.commits = new DriverError("E_NOT_SETTLED", "The UI kept mounting changes until the timeout");
    expect((await run("- launchApp\n- assertNoFlicker: { during: { tapOn: { id: go } } }", busy)).result.failure).toMatchObject({ kind: "error", message: "assertNoFlicker: E_NOT_SETTLED: The UI kept mounting changes until the timeout" });
  });

  test("assertNoLeaks compares the leak counters after running `run` `repeat` times with those before it", async () => {
    const app = new FakeApp({ go: 1 });
    const { result } = await run("- launchApp\n- assertNoLeaks: { repeat: 3, run: [{ tapOn: { id: go } }] }", app);
    expect(result.status).toBe("passed");
    expect(renderLog(app)).toEqual(["counters 5000", "tap go+50,20 {}", "tap go+50,20 {}", "tap go+50,20 {}", "counters 5000"]);
    const leaking = new FakeApp({ go: 1 });
    let calls = 0;
    leaking.counters = () => ({ ...COUNTERS, views: COUNTERS.views + 10 * calls, listeners: COUNTERS.listeners + calls++ });
    expect((await run("- launchApp\n- assertNoLeaks: { repeat: 2, run: [{ tapOn: { id: go } }] }", leaking)).result.failure).toMatchObject({
      kind: "assertion", message: "leak counters grew after running 2 times: views 400 → 410, listeners 12 → 13",
    });
  });

  test("since: flowStart compares with the counters taken before the flow's first command on the launch, only when a flow asks", async () => {
    const app = new FakeApp({ go: 1 });
    let calls = 0;
    app.counters = () => ({ ...COUNTERS, windows: COUNTERS.windows + (calls++ === 0 ? 0 : 1) });
    const { result } = await run("- launchApp\n- assertVisible: { id: go }\n- tapOn: { id: go }\n- runFlow: { commands: [{ assertNoLeaks: { since: flowStart } }] }", app);
    expect(result.failure).toMatchObject({ kind: "assertion", message: "leak counters grew: windows 2 → 3" });
    expect(renderLog(app)).toEqual(["counters undefined", "tap go+50,20 {}", "counters 5000"]);
    const plain = await run("- launchApp\n- assertNoLeaks: { run: [{ tapOn: { id: go } }] }", new FakeApp({ go: 1 }));
    expect(renderLog(plain.app)[0]).toBe("counters 5000");
    expect((await run("- launchApp\n- assertNoLeaks: { since: mark }")).result.failure).toMatchObject({ kind: "unsupported" });
  });

  test("assertMemory records the app's footprint as memory.mb and checks maxMB", async () => {
    const { result } = await run("- launchApp\n- assertMemory: { maxMB: 400 }");
    expect([result.status, result.metrics]).toEqual(["passed", { "memory.mb": [300] }]);
    expect((await run("- launchApp\n- assertMemory: { maxMB: 200 }")).result.failure).toMatchObject({ kind: "assertion", message: "the app's memory footprint is 300 MB, more than 200 MB" });
    expect((await run("- launchApp\n- assertMemory: { window: main, maxMB: 400 }")).result.failure).toMatchObject({ kind: "unsupported" });
  });
});

describe("unsupported and invalid", () => {
  test.each([
    ["- assertA11y: { id: save, hint: Saves }", "assertA11y hint is not supported by backend driver"],
    ["- selectMenu: File > Open", "selectMenu needs a black-box backend (active: driver (driver)); backend driver cannot run it in-process"],
    ["- hoverOn: { id: save, duration: 1s }", "hoverOn duration is not supported by backend driver"],
    ["- scroll: { on: { id: list }, momentum: true }", "scroll momentum is not supported by backend driver"],
    ["- scroll: { direction: down }", "backend driver scrolls only `on` a target"],
    ["- swipe: { direction: up }", "backend driver swipes only `from` a target"],
    ["- swipe: { from: { id: list }, direction: up, fingers: 4 }", "backend driver swipes with one or two fingers (a scroll) or three (a swipe gesture)"],
    ['- swipe: { from: { id: list }, start: "10%,50%", end: "90%,50%", fingers: 3 }', "backend driver swipes three fingers only in a `direction`"],
    ["- mouseButton: back", "backend driver presses a mouse button only `on` a target"],
    ["- pinch: { scale: 2 }", "backend driver performs pinch only `on` a target"],
    ["- rotate: { degrees: 10 }", "backend driver performs rotate only `on` a target"],
    ["- dragAndDrop: { from: { id: row }, to: { id: list }, holdAt: 1s }", "dragAndDrop holdAt is not supported by backend driver"],
    ["- assertText: { id: save, equals: x, lineEndings: crlf }", "assertText lineEndings is not supported by backend driver"],
    ["- pressKey: MediaPlayPause", "backend driver cannot press MediaPlayPause"],
    ["- pressKey: capslock+a", "backend driver cannot press capslock+a"],
    ["- killApp", "killApp is not supported by backend driver"],
    ["- assertEnergy: low", "assertEnergy is not supported by backend driver"],
    ["- launchApp: { appId: com.example.other, from: dock }", "launchApp appId, from is not supported by backend driver"],
  ])("%s fails as unsupported", async (command, message) => {
    const views = { list: 1, row: 1 };
    const { result } = await run(`- launchApp\n${command}`, new FakeApp(views));
    expect(result.failure).toMatchObject({ kind: "unsupported", message });
  });

  test.each([
    ['- launchApp: { arguments: ["-RCT_jsLocation", "example.com:80"] }', "", "launchApp -RCT_jsLocation is reserved by backend driver"],
    ['- launchApp: { env: { SPARK_BUNDLE_URL: "http://example.com", SPARK_TEST_DRIVER_DIR: /tmp } }', "", "launchApp SPARK_BUNDLE_URL, SPARK_TEST_DRIVER_DIR are reserved by backend driver"],
    ['- launchApp: { arguments: ["-AppleLanguages", "(fr)"] }', "matrix:\n  locale: [ar]\n", "launchApp -AppleLanguages is reserved by backend driver"],
    ["- launchApp: { openFile: notes.md }", "", "launchApp openFile notes.md is not an absolute path to an existing file"],
    ["- launchApp: { openFile: /nonexistent/notes.md }", "", "launchApp openFile /nonexistent/notes.md is not an absolute path to an existing file"],
    ["- launchApp\n- launchApp: { stopApp: false, clearState: true, env: { A: b } }", "", "launchApp clearState, env need a new launch, but stopApp: false keeps the running app"],
  ])("%s is invalid before anything launches", async (commands, header, message) => {
    const { result, app } = await run(commands, new FakeApp(), header);
    expect(result.failure).toMatchObject({ kind: "invalid", message });
    expect(app.log.filter(line => line.startsWith("launch") || line === "clearState")).toEqual(commands.startsWith("- launchApp\n") ? ["launch locale=- log=app-1.log"] : []);
  });

  test("a matrix dimension the driver does not apply is unsupported", async () => {
    const { result } = await run("- launchApp", new FakeApp(), "matrix:\n  reduceMotion: [true]\n");
    expect(result.failure).toMatchObject({ kind: "unsupported", message: "no active backend applies matrix dimension reduceMotion (active: driver)" });
  });

  test("driver commands before launchApp are invalid; after the app exits they are errors", async () => {
    expect((await run("- setAppAppearance: dark")).result.failure).toMatchObject({ kind: "invalid", message: "the app is not running; start the flow with launchApp" });
    const app = new FakeApp();
    const launched = app.launch.bind(app);
    app.launch = async options => { const driver = await launched(options); driver.running = false; return driver; };
    expect((await run("- launchApp\n- takeScreenshot: x", app)).result.failure).toMatchObject({ kind: "error", message: expect.stringMatching(/^the app exited; see .*app-1\.log$/) });
  });

  test("a flow for another app is invalid, and the app is closed although the backend never started", async () => {
    const { result, app } = await run("- launchApp", new FakeApp({}, "com.example.other"));
    expect(result.failure).toMatchObject({ kind: "invalid", message: "the flow is for so.legend.spark.examples.kitchensink, but /Apps/KitchenSink.app is com.example.other" });
    expect(app.log).toEqual(["open", "app close"]);
  });

  test("a flow for the App Sandbox variant is invalid against an app that is not sandboxed, and runs against one that is", async () => {
    const { result, app } = await run("- launchApp", new FakeApp(), "variant: sandbox\n");
    expect(result.failure).toMatchObject({ kind: "invalid", message: "the flow tests the App Sandbox variant (spark build --sandbox, docs/app-sandbox.md), but /Apps/KitchenSink.app is not sandboxed" });
    expect(app.log).toEqual(["open", "app close"]);
    const sandboxed = new FakeApp();
    sandboxed.bundle = { ...sandboxed.bundle, sandboxed: true };
    expect((await run("- launchApp", sandboxed, "variant: sandbox\n")).result.status).toBe("passed");
  });

  test("other driver failures surface as errors", async () => {
    const app = new FakeApp();
    const launched = app.launch.bind(app);
    app.launch = async options => {
      const driver = await launched(options);
      driver.capture = async () => { throw new DriverError("E_NOT_SETTLED", "The UI kept mounting changes until the timeout"); };
      return driver;
    };
    expect((await run("- launchApp\n- takeScreenshot: x", app)).result.failure).toMatchObject({ kind: "error", message: "E_NOT_SETTLED: The UI kept mounting changes until the timeout" });
  });
});
