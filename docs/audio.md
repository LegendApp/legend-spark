# Audio player

```ts
import { createAudioPlayer } from '@legendapp/spark/audio';

const player = await createAudioPlayer({ uri, title: 'My track' });
await player.play();
await player.seekTo(10); // seconds
const status = await player.getStatus();
await player.pause();
await player.remove(); // release the player when its owner is finished
```

The contract uses Expo-style source, player, and position names, with asynchronous
commands consistently across backends. It is a deliberately small framework
contract, not a re-export of every Expo Audio option. Status includes `playing`,
`currentTime`, `duration`, `didJustFinish`, and `error`. Creation waits for media readiness (metadata on web), with a default 15-second
readiness timeout. Set `loadTimeoutMs` to change it or pass `signal` to abort loading.
The timer begins after allocation; it does not time out the native bridge itself.
Aborting after creation has resolved does not remove a live player. Inspect status
for later playback failures. Failed loading awaits resource cleanup before rejecting;
if cleanup also fails, `E_NATIVE` preserves both failures in an AggregateError cause.

Use Expo Audio 1.1.1 and its background-playback plugin in a mobile consumer. The
native desktop implementations require a rebuilt client. The maintained prebuilt profile
includes audio; custom projects include it by adding the package. Windows source
is present but native acceptance remains open.

The Music template configures these dependencies automatically. When adding audio
manually to a universal project, exclude `@legendapp/spark/audio` from native autolinking
on iOS/Android and exclude `expo-audio` on macOS/Windows using `expoByPlatform`.
These exclusions affect native linking and codegen; Metro still selects the
framework's mobile JavaScript adapter. Keep the Expo Audio plugin on mobile only.

The Music Lite example shows polling with cleanup, queue ownership, resource
release, persistent position, file import, and media controls. The active player
owns system media controls; applications should arbitrate playback themselves
before creating multiple players. Each platform decides which codecs it supports.
HTTP sources follow platform transport policy. Browser playback may require a user
gesture. Android sustained background playback requires the Expo configuration and
lock-screen controls used by the example.

Replacement implementations must preserve seconds, explicit resource disposal,
command failures, and status semantics. No player, queue, or audio module is loaded
by the framework root. Use direct external-library imports for capabilities outside
this contract, such as recording or sample analysis.

## Volume, metadata, and status observation

```ts
await player.setVolume(0.5); // 0–1
await player.setMetadata({ title: 'Episode', artist: 'Host', albumTitle: 'Series', artworkUrl: 'https://example.com/cover.png' });
const subscription = player.addListener('playbackStatusUpdate', status => {
  // Includes volume, position, completion and errors. No React state is required.
});
subscription.remove();
```

Status subscriptions sample at 250 ms only while observed. They report state, not
an exact event journal. Removal stops callbacks, and player disposal removes all
subscriptions. Artwork loading is best effort; transport/decoding failures remain
visible through player status. Replacing a player does not transfer its listeners.

## Independent system media sessions

Desktop and web can publish controls for an external playback engine:

```ts
import { createMediaSession } from '@legendapp/spark/audio';
const session = await createMediaSession({
  metadata: { title: 'Episode', artist: 'Host' },
  playbackState: 'playing', position: 12, duration: 120,
  commands: ['play', 'pause', 'nextTrack', 'previousTrack', 'seekTo'],
}, command => {
  // Route to your engine; seekTo includes position in seconds.
});
await session.update({ playbackState: 'paused', position: 30 });
await session.remove();
```

One explicit session owns the system controls. Creating another replaces it;
updates to the old session reject, and disposing it cannot clear the new session.
Explicit sessions take precedence over built-in players. Removing one clears its
controls; it does not silently restore a previous player. Updates patch session
fields; `metadata` replaces the metadata object. The application supplies progress
and owns queue/next/previous behavior. Commands never mutate an external player.
Desktop command delivery drains a bounded native queue every 100 ms while the
session is active. Treat callbacks as commands, not confirmations of playback.
Web support depends on browser Media Session action support. Windows owns a
MediaPlayer-backed SMTC session with its automatic command manager disabled.

On iOS/Android, player volume and metadata delegate to Expo Audio. Standalone
sessions for external engines explicitly reject with `E_UNAVAILABLE`: Expo Audio
binds its lock-screen controls to its own player. This module does not invent a
mobile media service or claim arbitrary-engine parity. Recording, queue management,
provider SDKs and media indexing remain outside this contract.

`node scripts/test-audio.ts` builds and runs the macOS probe for real local decoding,
volume, seek, status cleanup, metadata, command configuration and session replacement.
It does not synthesize OS media-key input. Check real system controls and artwork
visually on both platforms. Windows native compilation/runtime acceptance remains
pending. Rebuild the native runtime for these additions.

## Resource and React lifecycle

Commands return promises, including argument failures. Each player orders accepted
commands and snapshots metadata before queuing it. `setMetadata(null)` clears
metadata; an object replaces it. `remove()` stops callbacks immediately, waits for
already accepted commands, and releases resources. Concurrent removes share their
completion. Failed cleanup can be retried; new commands reject with `E_CLOSED` once
removal starts. Native result shape failures use `E_INVALID_DATA`, and loading
cancellation/timeout use `E_ABORTED`/`E_TIMEOUT`.

```tsx
const audio = useAudioPlayer({ uri, title: 'My track' });
if (audio.status === 'loading') return <Text>Loading audio…</Text>;
if (audio.status === 'error') return <Text>{String(audio.error)}</Text>;
// audio.player is ready; the hook owns its cleanup.
```

The hook creates players in effects. Source/title or load-option changes replace
the player; an unmounted or superseded load is aborted, and any late-created player
is removed. Cleanup failures go to `onCleanupError(error, player)` when supplied
(the player supports retry); otherwise they are logged. For application-wide queue
ownership, use the factory and await removal yourself. This asynchronous state
contract intentionally differs from Expo's immediately returned player hook.
