import { useCallback, useEffect, useRef, useState } from "react";
import { getPermissionStatus, requestPermission } from "@legendapp/spark/permissions";
import {
  getSpeakingStatus, getSpeechAvailability, getSpeechRecognitionLocales, getSpeechRecognizerStatus, getVoices, pauseSpeaking, resumeSpeaking, speak,
  startSpeechRecognition, stopSpeaking, type SpeechRecognitionOutcome, type SpeechRecognitionSession,
} from "@legendapp/spark/speech";
import { describeFailure } from "./video-demo";

/** What the screen speaks; API data, so flows can assert it in any locale. */
export const PHRASE = "Spark speaks every word";
/** The recognition locale; every Mac recognizes it. */
export const LOCALE = "en-US";
export type SpeakStyle = "normal" | "fast";
const STYLES: Record<SpeakStyle, { rate: number; pitch: number; volume: number }> = { normal: { rate: 1, pitch: 1, volume: 1 }, fast: { rate: 1.5, pitch: 1.2, volume: 0.5 } };
const KEEP = 8;
const describeOutcome = (outcome: SpeechRecognitionOutcome) => outcome.status === "recognized" ? `recognized: ${outcome.transcript} (${outcome.segments.length} segments)` : outcome.status;
export type SpeechEventEntry = { key: number; text: string };

/**
 * Speech synthesis and recognition through @legendapp/spark/speech. Opening the screen only reads voices, states and
 * permissions; nothing speaks or listens until a button is pressed. In a test-driver run utterances are recorded, never
 * spoken, and recognition plays back a scripted transcript without a microphone (docs/speech.md#testing).
 */
export function useSpeechDemo() {
  const [voices, setVoices] = useState<string>();
  const [speaking, setSpeaking] = useState<string>();
  const [word, setWord] = useState<string>();
  const [events, setEvents] = useState<readonly SpeechEventEntry[]>([]);
  const [spoken, setSpoken] = useState<string>();
  const [permissions, setPermissions] = useState<string>();
  const [recognizer, setRecognizer] = useState<string>();
  const [partial, setPartial] = useState<string>();
  const [outcome, setOutcome] = useState<string>();
  const session = useRef<SpeechRecognitionSession | undefined>(undefined);
  const received = useRef(0);
  const log = useCallback((text: string) => setEvents(list => [{ key: ++received.current, text }, ...list].slice(0, KEEP)), []);

  const refreshSpeaking = useCallback(() => getSpeakingStatus().then(status => `speaking ${status.speaking} · paused ${status.paused}`, describeFailure).then(setSpeaking), []);
  const refreshPermissions = useCallback(() => Promise.all((["speechRecognition", "microphone"] as const).map(kind => getPermissionStatus(kind).then(permission => `${kind} ${permission.status}`, describeFailure)))
    .then(states => setPermissions(states.join(" · "))), []);
  const refreshRecognizer = useCallback(() => Promise.all([getSpeechRecognizerStatus({ locale: LOCALE }), getSpeechRecognitionLocales()])
    .then(([status, locales]) => `${status.locale} · supported ${status.supported} · available ${status.available} · on device ${status.onDevice} · listed ${locales.includes(status.locale)}`, describeFailure)
    .then(setRecognizer), []);
  useEffect(() => {
    getVoices().then(list => `${list.length} voices`, describeFailure).then(setVoices);
    void refreshSpeaking(); void refreshPermissions(); void refreshRecognizer();
  }, [refreshSpeaking, refreshPermissions, refreshRecognizer]);
  // Leaving the screen ends what it started: the microphone stops and speech goes quiet.
  useEffect(() => () => {
    void session.current?.cancel().catch(console.error);
    session.current = undefined;
    void stopSpeaking().catch(console.error);
  }, []);

  const say = useCallback(async (style: SpeakStyle) => {
    setSpoken(undefined);
    try {
      const result = await speak(PHRASE, { ...STYLES[style], onStart: () => { log("start"); void refreshSpeaking(); },
        onWord: next => { setWord(`${next.word} (${next.charIndex}+${next.charLength})`); log(`word ${next.word}`); },
        onPause: () => log("pause"), onResume: () => log("resume") });
      setSpoken(`${style}: ${result.finished ? "finished" : "stopped"}`);
    } catch (cause) { setSpoken(`${style}: ${describeFailure(cause)}`); }
    void refreshSpeaking();
  }, [log, refreshSpeaking]);
  const control = useCallback(async (action: "pause" | "resume" | "stop") => {
    try { await (action === "pause" ? pauseSpeaking({ boundary: "word" }) : action === "resume" ? resumeSpeaking() : stopSpeaking()); }
    catch (cause) { setSpoken(`${action}: ${describeFailure(cause)}`); }
    void refreshSpeaking();
  }, [refreshSpeaking]);

  const request = useCallback(async () => {
    try { for (const kind of ["speechRecognition", "microphone"] as const) await requestPermission(kind); }
    catch (cause) { setOutcome(`permissions: ${describeFailure(cause)}`); }
    void refreshPermissions();
  }, [refreshPermissions]);
  const listen = useCallback(async (onDevice: boolean) => {
    setPartial(undefined); setOutcome(undefined);
    void refreshRecognizer();
    try {
      const started = await startSpeechRecognition({ locale: LOCALE, onDevice, onPartialResult: result => setPartial(result.transcript) });
      session.current = started;
      setOutcome("listening");
      const final = await started.result;
      if (session.current === started) session.current = undefined;
      setOutcome(describeOutcome(final));
    } catch (cause) { setOutcome(describeFailure(cause)); }
  }, [refreshRecognizer]);
  const finish = useCallback(async (action: "stop" | "cancel") => {
    try { if (action === "stop") await session.current?.stop(); else await session.current?.cancel(); }
    catch (cause) { setOutcome(`${action}: ${describeFailure(cause)}`); }
  }, []);

  return {
    availability: getSpeechAvailability(), voices, speaking, word, events, spoken, permissions, recognizer, partial, outcome,
    say, control, request, listen, finish,
  };
}
