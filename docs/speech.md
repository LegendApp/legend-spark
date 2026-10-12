# Speech

`@legendapp/spark/speech` speaks text (AVSpeechSynthesizer) and transcribes the microphone (SFSpeechRecognizer).

```ts
import { getVoices, speak, startSpeechRecognition, stopSpeaking } from '@legendapp/spark/speech';
import { requestPermission } from '@legendapp/spark/permissions';

const voices = await getVoices();
const result = await speak('Welcome back', { voice: voices[0]?.identifier, rate: 1.2, onWord: word => highlight(word.charIndex, word.charLength) });
// result.finished is false when stopSpeaking() stopped it.

// From a person's action: recognition never prompts by itself.
await requestPermission('speechRecognition');
await requestPermission('microphone');
const session = await startSpeechRecognition({ onDevice: true, onPartialResult: ({ transcript }) => show(transcript) });
const outcome = await session.stop(); // { status: 'recognized', transcript, segments } | { status: 'noSpeech' } | { status: 'cancelled' }
```

## Text to speech

`getVoices()` lists the installed voices: `identifier`, `name`, `language` (BCP 47), `quality` (`default`, `enhanced`,
`premium`) and `gender`.

`speak(text, options?)` queues `text` (1–100000 characters) after any utterance speaking or queued, and resolves when it
ends: `{ finished: true }`, or `{ finished: false }` when `stopSpeaking()` stopped it, whether it was speaking or
queued. Options:

| Option | Meaning |
| --- | --- |
| `voice` | A voice identifier; unknown rejects `E_NOT_FOUND`. Wins over `language`. |
| `language` | The default voice for a BCP 47 language; none rejects `E_UNAVAILABLE`. Default: the system voice. |
| `rate` | 0.1–2; 1 is the normal rate (`AVSpeechUtteranceDefaultSpeechRate`), scaled linearly and clamped to the synthesizer's range. |
| `pitch` | 0.5–2 (`pitchMultiplier`). |
| `volume` | 0–1. |
| `onStart`, `onWord`, `onPause`, `onResume` | This utterance's events. `onWord` gets `{ charIndex, charLength, word }` in UTF-16 code units of `text`, before each word is spoken. |

`stopSpeaking()` stops at once and drops the queue; `pauseSpeaking({ boundary })` pauses at once (`immediate`, the
default) or after the current word (`word`); `resumeSpeaking()` continues; `getSpeakingStatus()` returns
`{ speaking, paused }`.

## Speech recognition

`getSpeechRecognizerStatus({ locale? })` says whether a locale is `supported`, `available` now (server recognition needs
the network) and recognizable `onDevice`, without prompting. `getSpeechRecognitionLocales()` lists the supported
locales.

`startSpeechRecognition(options?)` listens to the default microphone and resolves a session once audio flows. It never
prompts: it rejects `E_PERMISSION_DENIED` unless the `speechRecognition` and `microphone` permissions
(`@legendapp/spark/permissions`, [permissions.md](permissions.md)) are granted, so request them from a person's action
first; the app's Info.plist needs `NSSpeechRecognitionUsageDescription` and `NSMicrophoneUsageDescription`. It rejects
`E_UNAVAILABLE` for an unsupported or currently unavailable locale, or for `onDevice: true` where the locale has no
on-device model (then audio never leaves the Mac), and `E_BUSY` while another recognition runs (one at a time per app).

| Option | Meaning |
| --- | --- |
| `locale` | Default: the current locale. |
| `onDevice` | Require on-device recognition. Default false (macOS may use Apple's servers). |
| `partialResults` | Report partial transcripts to `onPartialResult`. Default true. |
| `punctuation` | Add punctuation (`addsPunctuation`). Default false. |
| `contextualStrings` | Up to 100 phrases to favor, such as names. |
| `onPartialResult` | `{ transcript, segments }` while the person speaks. |
| `signal` | Aborting cancels. |

The session's `result` settles once: `recognized` with the `transcript` and `segments` (`substring`, `timestamp`,
`duration` in seconds, `confidence` 0–1), `noSpeech`, or `cancelled`; a recognition failure rejects it `E_NATIVE`.
`stop()` stops listening and resolves the final result; `cancel()` discards it. macOS also ends a recognition by itself
(after about a minute, or on an error); `result` reports that.

## Testing

In driver mode (the in-app test driver, [test-driver.md](test-driver.md)) speech is simulated in the app's memory:
utterances are recorded and never spoken, timed word by word (20 ms per word by default) with the same start, word,
pause and resume events; recognition never touches the microphone, a recognizer or TCC, and plays back a scripted
transcript. `getVoices()` and the supported locales stay real. Recognition still checks the permissions, which the
permissions package simulates in driver mode ([permissions.md](permissions.md#testing)). Two driver commands, built
only with the driver (`#if SPARK_TEST_DRIVER`):

- `{"command": "simulateSpeech", "wordMs"?, "recognizerAvailable"?, "onDeviceSupported"?, "recognitionPartials"?,
  "recognitionTranscript"?}` sets how long a simulated word takes (1–10000 ms), whether the recognizer is available and
  recognizes on device, the partial transcripts a recognition reports once listening (one per word time), and the
  final transcript once it stops (`null`: nobody spoke, so `noSpeech`).
- `{"command": "testSpeech"}` replies `speech`: that state, the recorded `utterances` (`text`, `voice`, `language`,
  `rate`, `pitch`, `volume`), `speaking`, `paused`, the number of `recognitions`, whether one is `listening`, and the
  last recognition's options.

Flows use them as `simulateSpeech` and `assertSimulatedSpeech` ([e2e-flow-commands.md](e2e-flow-commands.md)).
`tests/media.native.mm` checks validation, rate mapping, word boundaries and the simulation; real speech and a real
microphone are checked only by the manual flow `e2e/flows/media/speech-real.yaml`.

## Platforms

| Platform | Availability |
| --- | --- |
| macOS | Available (macOS 14 and later). On-device recognition depends on the locale and the Mac. |
| Windows | `getSpeechAvailability()` reports `unsupported-platform`; the other functions reject `E_UNSUPPORTED_PLATFORM` after validating their arguments. `SpeechSynthesizer` and `SpeechRecognizer` are tracked in #403. |

The Kitchen Sink's Speech screen (`spark-ks://media/speech`) speaks with a chosen rate, pitch and volume, highlights
word boundaries, pauses, resumes and stops, and runs a recognition with partial results; its flows are in
`e2e/flows/media/`.
