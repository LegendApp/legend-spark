import { SparkError, type Availability, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent, type DesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { getPermissionStatus } from "@legendapp/spark-permissions";
import { call, checkBoolean, checkCallback, checkOptions, checkRange, checkSignal, isNull, isNumber, isRecord, mediaAvailability, requireMedia, uniqueId } from "./shared";
export type { Availability } from "@legendapp/spark-desktop-app/src/contracts";

export interface SpeechVoice {
  identifier: string;
  name: string;
  /** BCP 47, such as en-US. */
  language: string;
  quality: "default" | "enhanced" | "premium";
  gender: "male" | "female" | "unspecified";
}
/** A word about to be spoken: its range in the text, in UTF-16 code units. */
export interface SpeechWord { charIndex: number; charLength: number; word: string }
export interface SpeakOptions {
  /** A voice identifier from getVoices(). Wins over `language`. */
  voice?: string;
  /** BCP 47: the default voice for the language. Default: the system voice. */
  language?: string;
  /** 0.1–2; 1 is the normal rate. */
  rate?: number;
  /** 0.5–2; 1 is the voice's pitch. */
  pitch?: number;
  /** 0–1. Default 1. */
  volume?: number;
  onStart?: () => void;
  onWord?: (word: SpeechWord) => void;
  onPause?: () => void;
  onResume?: () => void;
}
/** `finished: false`: stopSpeaking stopped it, spoken or queued. */
export interface SpeakResult { finished: boolean }
export interface SpeakingStatus { speaking: boolean; paused: boolean }
export interface PauseSpeakingOptions {
  /** immediate (default), or after the current word. */
  boundary?: "immediate" | "word";
}

export interface SpeechRecognizerStatus {
  /** The locale identifier asked about (BCP 47). */
  locale: string;
  /** Whether macOS recognizes this locale at all. */
  supported: boolean;
  /** Whether it can recognize now (server recognition needs the network). */
  available: boolean;
  /** Whether it can recognize on this Mac, without sending audio to Apple. */
  onDevice: boolean;
}
export interface SpeechRecognitionSegment { substring: string; timestamp: number; duration: number; confidence: number }
export interface SpeechTranscript { transcript: string; segments: SpeechRecognitionSegment[] }
export type SpeechRecognitionOutcome = ({ status: "recognized" } & SpeechTranscript) | { status: "noSpeech" } | { status: "cancelled" };
export interface SpeechRecognitionOptions {
  /** Default: the current locale. */
  locale?: string;
  /** Require on-device recognition: audio never leaves the Mac. Rejects E_UNAVAILABLE where the locale has none. */
  onDevice?: boolean;
  /** Report partial transcripts to onPartialResult. Default true. */
  partialResults?: boolean;
  /** Add punctuation to the transcript. Default false. */
  punctuation?: boolean;
  /** Up to 100 phrases (names, jargon) to favor. */
  contextualStrings?: readonly string[];
  onPartialResult?: (result: SpeechTranscript) => void;
  /** Aborting cancels the recognition (outcome cancelled). */
  signal?: AbortSignal;
}
export interface SpeechRecognitionSession {
  /** Settles once: the final transcript, noSpeech, or cancelled; rejects when recognition fails. */
  readonly result: Promise<SpeechRecognitionOutcome>;
  /** Stops listening and resolves with the final result. */
  stop(): Promise<SpeechRecognitionOutcome>;
  /** Discards the recognition; `result` resolves cancelled. */
  cancel(): Promise<void>;
}

/** macOS only. Windows reports `unsupported-platform` (#403). */
export function getSpeechAvailability(): Availability { return mediaAvailability(); }

const VOICE_QUALITIES = ["default", "enhanced", "premium"];
const VOICE_GENDERS = ["male", "female", "unspecified"];
const isVoice = (value: unknown): value is SpeechVoice => isRecord(value) && typeof value.identifier === "string" && typeof value.name === "string" && typeof value.language === "string"
  && VOICE_QUALITIES.includes(value.quality as string) && VOICE_GENDERS.includes(value.gender as string);

/** The voices installed on this Mac. */
export async function getVoices(): Promise<SpeechVoice[]> {
  return call(requireMedia("Speech"), "voices", {}, (value): value is SpeechVoice[] => Array.isArray(value) && value.every(isVoice));
}

const isWord = (event: DesktopEvent): event is DesktopEvent & SpeechWord => isNumber(event.charIndex) && isNumber(event.charLength) && typeof event.word === "string";
function callback(name: string, run: () => void) { try { run(); } catch (error) { console.error(new SparkError("E_NATIVE", `The speech ${name} callback failed`, { cause: error })); } }

/**
 * Speaks `text`, after any utterance already speaking or queued. Resolves when it finishes, or `finished: false` when
 * stopSpeaking stops it. Rejects E_NOT_FOUND for an unknown voice and E_UNAVAILABLE for a language without one.
 */
export async function speak(text: string, options: SpeakOptions = {}): Promise<SpeakResult> {
  if (typeof text !== "string" || !text.trim() || text.length > 100000) throw new SparkError("E_INVALID_ARGUMENT", "Speech text is 1–100000 characters, not only whitespace");
  const checked = checkOptions(options, ["voice", "language", "rate", "pitch", "volume", "onStart", "onWord", "onPause", "onResume"], "speech");
  for (const key of ["voice", "language"]) if (checked[key] !== undefined && (typeof checked[key] !== "string" || !checked[key])) throw new SparkError("E_INVALID_ARGUMENT", `${key} is a nonempty string`);
  const rate = checkRange(checked.rate, "rate", 0.1, 2), pitch = checkRange(checked.pitch, "pitch", 0.5, 2), volume = checkRange(checked.volume, "volume", 0, 1);
  for (const key of ["onStart", "onWord", "onPause", "onResume"]) checkCallback(checked[key], key);
  const native = requireMedia("Speech");
  const { onStart, onWord, onPause, onResume } = options;
  const id = uniqueId("utterance");
  let subscription: Subscription | undefined;
  if (onStart || onWord || onPause || onResume) subscription = onDesktopEvent(event => {
    if (event.event === "start") { if (onStart) callback("onStart", onStart); }
    else if (event.event === "word") { if (onWord && isWord(event)) callback("onWord", () => onWord({ charIndex: event.charIndex, charLength: event.charLength, word: event.word })); }
    else if (event.event === "pause") { if (onPause) callback("onPause", onPause); }
    else if (event.event === "resume") { if (onResume) callback("onResume", onResume); }
  }, { types: ["speech"], target: { field: "id", value: id } });
  try {
    return await call(native, "speak", { id, text, options: { voice: checked.voice, language: checked.language, rate, pitch, volume } },
      (value): value is SpeakResult => isRecord(value) && typeof value.finished === "boolean");
  } finally { subscription?.remove(); }
}

const command = async (method: string, args: Record<string, unknown> = {}) => { await call(requireMedia("Speech"), method, args, isNull); };
/** Stops the utterance speaking and drops the queued ones; each speak() resolves `finished: false`. */
export function stopSpeaking(): Promise<void> { return command("stopSpeaking"); }
export async function pauseSpeaking(options: PauseSpeakingOptions = {}): Promise<void> {
  const boundary = checkOptions(options, ["boundary"], "pause").boundary ?? "immediate";
  if (boundary !== "immediate" && boundary !== "word") throw new SparkError("E_INVALID_ARGUMENT", "boundary is immediate or word");
  await command("pauseSpeaking", { boundary });
}
export function resumeSpeaking(): Promise<void> { return command("continueSpeaking"); }
export async function getSpeakingStatus(): Promise<SpeakingStatus> {
  return call(requireMedia("Speech"), "speakingStatus", {}, (value): value is SpeakingStatus => isRecord(value) && typeof value.speaking === "boolean" && typeof value.paused === "boolean");
}

function locale(value: unknown): string | undefined {
  if (value !== undefined && (typeof value !== "string" || !/^[A-Za-z]{2,8}([-_][A-Za-z0-9]{1,8})*$/.test(value))) throw new SparkError("E_INVALID_ARGUMENT", "locale is a locale identifier such as en-US");
  return value as string | undefined;
}

/** Whether a locale can be recognized, now, and on this Mac. Never prompts. */
export async function getSpeechRecognizerStatus(options: { locale?: string } = {}): Promise<SpeechRecognizerStatus> {
  const requested = locale(checkOptions(options, ["locale"], "speech recognizer").locale);
  return call(requireMedia("Speech recognition"), "recognizerStatus", { locale: requested }, (value): value is SpeechRecognizerStatus =>
    isRecord(value) && typeof value.locale === "string" && ["supported", "available", "onDevice"].every(key => typeof value[key] === "boolean"));
}
/** The locales speech recognition supports, sorted. */
export async function getSpeechRecognitionLocales(): Promise<string[]> {
  return call(requireMedia("Speech recognition"), "recognitionLocales", {}, (value): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string"));
}

const isSegments = (value: unknown): value is SpeechRecognitionSegment[] => Array.isArray(value) && value.every(segment => isRecord(segment) && typeof segment.substring === "string" && ["timestamp", "duration", "confidence"].every(key => isNumber(segment[key])));
const isOutcome = (value: unknown): value is SpeechRecognitionOutcome => isRecord(value) && (value.status === "noSpeech" || value.status === "cancelled"
  || (value.status === "recognized" && typeof value.transcript === "string" && isSegments(value.segments)));

/**
 * Listens to the default microphone and transcribes. Resolves once audio flows. Never prompts: it rejects
 * E_PERMISSION_DENIED unless the speechRecognition and microphone permissions are granted (requestPermission from
 * @legendapp/spark/permissions), E_UNAVAILABLE when the locale cannot be recognized now (or not on device, when required),
 * and E_BUSY while another recognition runs.
 */
export async function startSpeechRecognition(options: SpeechRecognitionOptions = {}): Promise<SpeechRecognitionSession> {
  const checked = checkOptions(options, ["locale", "onDevice", "partialResults", "punctuation", "contextualStrings", "onPartialResult", "signal"], "speech recognition");
  const requested = locale(checked.locale);
  const onDevice = checkBoolean(checked.onDevice, "onDevice"), partialResults = checkBoolean(checked.partialResults, "partialResults"), punctuation = checkBoolean(checked.punctuation, "punctuation");
  const strings = checked.contextualStrings;
  if (strings !== undefined && (!Array.isArray(strings) || strings.length > 100 || !strings.every(phrase => typeof phrase === "string" && phrase.length > 0))) throw new SparkError("E_INVALID_ARGUMENT", "contextualStrings lists at most 100 nonempty phrases");
  checkCallback(checked.onPartialResult, "onPartialResult");
  const signal = checkSignal(checked.signal);
  const native = requireMedia("Speech recognition");
  if (signal?.aborted) throw new SparkError("E_ABORTED", "Speech recognition was aborted before it started");
  for (const kind of ["speechRecognition", "microphone"] as const) {
    const permission = await getPermissionStatus(kind);
    if (!permission.granted) throw new SparkError("E_PERMISSION_DENIED", `Speech recognition needs the ${kind} permission (${permission.status}); request it from a person's action first`);
  }
  const id = uniqueId("recognition");
  const onPartial = options.onPartialResult;
  let started!: () => void;
  const listening = new Promise<void>(resolve => { started = resolve; });
  const subscription = onDesktopEvent(event => {
    if (event.event === "started") started();
    else if (event.event === "partial" && onPartial && typeof event.transcript === "string" && isSegments(event.segments)) {
      const partial = { transcript: event.transcript, segments: event.segments };
      callback("onPartialResult", () => onPartial(partial));
    }
  }, { types: ["speechRecognition"], target: { field: "id", value: id } });
  const result = call(native, "recognize", { id, locale: requested, onDevice, partialResults, punctuation, contextualStrings: strings }, isOutcome);
  const cancel = async () => { await call(native, "cancelRecognition", { id }, isNull); await result.catch(() => {}); };
  const abort = () => { void cancel().catch(console.error); };
  signal?.addEventListener("abort", abort, { once: true });
  const settled = result.finally(() => { subscription.remove(); signal?.removeEventListener("abort", abort); });
  settled.catch(() => {}); // Rejections surface through `result` and start, not as unhandled.
  await Promise.race([listening, settled]);
  return {
    result: settled,
    async stop() { await call(native, "finishRecognition", { id }, isNull); return settled; },
    cancel,
  };
}
