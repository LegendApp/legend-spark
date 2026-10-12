import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/speech against a mocked bridge: validation, wire shapes, utterance callbacks, recognition lifecycle and
// the permission check that keeps recognition from prompting.
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
let permissions: Record<string, string> = { speechRecognition: "authorized", microphone: "authorized" };
const platform = { OS: "macos" };
const media = { call: (method: string, args: string) => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(reply(method, JSON.parse(args))).then(value => JSON.stringify(value)); } };
const permissionModule = { call: (method: string, args: string) => { calls.push({ method: `permission.${method}`, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(permissions[JSON.parse(args).kind])); } };
const app = { call: () => Promise.resolve("null"), addListener() {}, removeListeners() {} };
const listeners: ((event: unknown) => void)[] = [];
class NativeEventEmitter { addListener(_name: string, listener: (event: unknown) => void) { listeners.push(listener); return { remove() { listeners.splice(listeners.indexOf(listener), 1); } }; } }
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: (name: string) => ({ NativeDesktopMedia: media, NativeDesktopPermissions: permissionModule })[name] ?? app }, NativeEventEmitter }));
const speech = await import("../packages/media/src/speech.ts");
const emit = (event: object) => [...listeners].forEach(listener => listener(event));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => { platform.OS = "macos"; reply = () => null; calls.length = 0; permissions = { speechRecognition: "authorized", microphone: "authorized" }; });

test("availability reports macOS and other platforms; unsupported and invalid calls reject before native work", async () => {
  expect(speech.getSpeechAvailability()).toEqual({ available: true });
  platform.OS = "windows";
  expect(speech.getSpeechAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(speech.speak("Hello")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(speech.getVoices()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(speech.startSpeechRecognition()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  platform.OS = "macos";
  await expect(speech.speak("  ")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(speech.speak("Hi", { rate: 3 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(speech.speak("Hi", { pitch: 0.1 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(speech.speak("Hi", { voice: "" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(speech.speak("Hi", { onWord: "x" as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(speech.speak("Hi", { queue: false } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(speech.pauseSpeaking({ boundary: "sentence" as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(speech.getSpeechRecognizerStatus({ locale: "not a locale" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(speech.startSpeechRecognition({ contextualStrings: [""] })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(speech.startSpeechRecognition({ continuous: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toEqual([]);
});

test("voices, speaking status, recognizer status and locales are validated", async () => {
  const voice = { identifier: "com.apple.voice.compact.en-US.Samantha", name: "Samantha", language: "en-US", quality: "default", gender: "female" };
  reply = method => ({ voices: [voice], speakingStatus: { speaking: true, paused: false }, recognizerStatus: { locale: "en-US", supported: true, available: true, onDevice: true }, recognitionLocales: ["ar-SA", "en-US"] })[method];
  expect(await speech.getVoices()).toEqual([voice]);
  expect(await speech.getSpeakingStatus()).toEqual({ speaking: true, paused: false });
  expect(await speech.getSpeechRecognizerStatus({ locale: "en-US" })).toEqual({ locale: "en-US", supported: true, available: true, onDevice: true });
  expect(calls.at(-1)).toEqual({ method: "recognizerStatus", args: { locale: "en-US" } });
  expect(await speech.getSpeechRecognitionLocales()).toEqual(["ar-SA", "en-US"]);
  reply = () => [{ ...voice, quality: "ultra" }];
  await expect(speech.getVoices()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  reply = () => null;
  await speech.stopSpeaking(); await speech.pauseSpeaking({ boundary: "word" }); await speech.pauseSpeaking(); await speech.resumeSpeaking();
  expect(calls.slice(-4)).toEqual([{ method: "stopSpeaking", args: {} }, { method: "pauseSpeaking", args: { boundary: "word" } }, { method: "pauseSpeaking", args: { boundary: "immediate" } }, { method: "continueSpeaking", args: {} }]);
});

test("speak sends the utterance, reports its own events to its callbacks and resolves when it ends", async () => {
  let finish!: (value: unknown) => void;
  reply = method => method === "speak" ? new Promise(resolve => { finish = resolve; }) : null;
  const heard: string[] = [];
  const spoken = speech.speak("Hello wide world", { voice: "v1", rate: 1.5, pitch: 0.8, volume: 0.4,
    onStart: () => heard.push("start"), onWord: word => heard.push(`${word.word}@${word.charIndex}+${word.charLength}`), onPause: () => heard.push("pause"), onResume: () => heard.push("resume") });
  await tick();
  const { id, ...args } = calls[0]!.args;
  expect(calls[0]!.method).toBe("speak");
  expect(args).toEqual({ text: "Hello wide world", options: { voice: "v1", rate: 1.5, pitch: 0.8, volume: 0.4 } });
  emit({ type: "speech", id, event: "start" });
  emit({ type: "speech", id, event: "word", charIndex: 6, charLength: 4, word: "wide" });
  emit({ type: "speech", id: "utterance-other", event: "word", charIndex: 0, charLength: 5, word: "Hello" });
  emit({ type: "speech", id, event: "word", charIndex: "x", charLength: 4, word: "bad" });
  emit({ type: "speech", id, event: "pause" });
  emit({ type: "speech", id, event: "resume" });
  finish({ finished: true });
  expect(await spoken).toEqual({ finished: true });
  emit({ type: "speech", id, event: "start" });
  expect(heard).toEqual(["start", "wide@6+4", "pause", "resume"]);
  reply = () => ({ finished: false });
  expect(await speech.speak("Stopped")).toEqual({ finished: false });
  reply = () => Promise.reject(Object.assign(new Error("No voice has the identifier x"), { code: "E_NOT_FOUND" }));
  await expect(speech.speak("Hi", { voice: "x" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});

test("recognition never starts without both permissions, and never asks for them", async () => {
  permissions = { speechRecognition: "notDetermined", microphone: "authorized" };
  await expect(speech.startSpeechRecognition()).rejects.toMatchObject({ code: "E_PERMISSION_DENIED", message: expect.stringContaining("speechRecognition") });
  permissions = { speechRecognition: "authorized", microphone: "denied" };
  await expect(speech.startSpeechRecognition()).rejects.toMatchObject({ code: "E_PERMISSION_DENIED", message: expect.stringContaining("microphone") });
  expect(calls.map(entry => entry.method)).toEqual(["permission.status", "permission.status", "permission.status"]);
});

test("a recognition resolves once listening, reports partial results, and stops with its final transcript", async () => {
  let finish!: (value: unknown) => void;
  reply = (method, args) => {
    if (method === "recognize") { setTimeout(() => emit({ type: "speechRecognition", id: args.id, event: "started" }), 1); return new Promise(resolve => { finish = resolve; }); }
    if (method === "finishRecognition") setTimeout(() => finish({ status: "recognized", transcript: "hello world", segments: [{ substring: "hello", timestamp: 0, duration: 0.4, confidence: 0.9 }] }), 1);
    return null;
  };
  const partials: string[] = [];
  const session = await speech.startSpeechRecognition({ locale: "en-US", onDevice: true, punctuation: true, contextualStrings: ["Spark"], onPartialResult: result => partials.push(result.transcript) });
  const recognize = calls.find(entry => entry.method === "recognize")!;
  expect(recognize.args).toEqual({ id: recognize.args.id, locale: "en-US", onDevice: true, punctuation: true, contextualStrings: ["Spark"] });
  emit({ type: "speechRecognition", id: recognize.args.id, event: "partial", transcript: "hel", segments: [] });
  emit({ type: "speechRecognition", id: "recognition-other", event: "partial", transcript: "other", segments: [] });
  emit({ type: "speechRecognition", id: recognize.args.id, event: "partial", transcript: "hello", segments: [{ substring: "hello", timestamp: 0, duration: 0.4, confidence: 0 }] });
  expect(partials).toEqual(["hel", "hello"]);
  const outcome = await session.stop();
  expect(outcome).toEqual({ status: "recognized", transcript: "hello world", segments: [{ substring: "hello", timestamp: 0, duration: 0.4, confidence: 0.9 }] });
  expect(await session.result).toBe(outcome);
  emit({ type: "speechRecognition", id: recognize.args.id, event: "partial", transcript: "late", segments: [] });
  expect(partials).toEqual(["hel", "hello"]);
});

test("cancel and abort end a recognition cancelled; a failure before listening rejects the start", async () => {
  let finish!: (value: unknown) => void;
  reply = (method, args) => {
    if (method === "recognize") { setTimeout(() => emit({ type: "speechRecognition", id: args.id, event: "started" }), 1); return new Promise(resolve => { finish = resolve; }); }
    if (method === "cancelRecognition") finish({ status: "cancelled" });
    return null;
  };
  const session = await speech.startSpeechRecognition();
  await session.cancel();
  expect(await session.result).toEqual({ status: "cancelled" });
  const controller = new AbortController();
  const aborted = await speech.startSpeechRecognition({ signal: controller.signal });
  controller.abort();
  expect(await aborted.result).toEqual({ status: "cancelled" });
  expect(calls.filter(entry => entry.method === "cancelRecognition")).toHaveLength(2);
  reply = method => method === "recognize" ? Promise.reject(Object.assign(new Error("Another speech recognition is running"), { code: "E_BUSY" })) : null;
  await expect(speech.startSpeechRecognition()).rejects.toMatchObject({ code: "E_BUSY" });
  reply = method => method === "recognize" ? { status: "listening" } : null;
  await expect(speech.startSpeechRecognition()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
