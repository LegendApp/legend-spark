# Video

`@legendapp/spark/video` plays video with AVFoundation: a player you create and command from any code, a `VideoView`
that shows it, fullscreen and picture in picture.

```tsx
import { VideoView, createVideoPlayer, getPictureInPictureAvailability } from '@legendapp/spark/video';

const player = await createVideoPlayer({ uri: '/Users/me/Movies/clip.mp4' }, { loop: true });
const subscription = player.addListener(event => {
  if (event.type === 'timeUpdate') setPosition(event.currentTime);
  if (event.type === 'end') showReplay();
});
await player.play();

<VideoView player={player} contentFit="contain" style={{ aspectRatio: 16 / 9 }} />;

await player.enterFullscreen();                         // Escape returns
if ((await getPictureInPictureAvailability()).available) await player.startPictureInPicture();

subscription.remove();
await player.remove();
```

## Players

`createVideoPlayer(source, options?)` takes an absolute path or a `file:`, `http:` or `https:` URL and resolves once the
item can play (`loadTimeoutMs`, default 15 seconds; `signal` aborts). Nothing plays until `play()`. Options: `loop`,
`muted`, `volume` (0–1), `rate` (0.25–4). A file that cannot be read rejects `E_NOT_FOUND`; media AVFoundation cannot load
rejects `E_NATIVE` with its reason; either way the native player is released.

Commands resolve when native work completes, in the order they were called: `seekTo(seconds)` resolves once the seek
is exact, and a later `play()` waits for it. `setRate` sets the rate playback runs at (now when playing, and for later
`play()`); `play()` at the end starts over. `getStatus()` returns `VideoStatus`:

| Field | Meaning |
| --- | --- |
| `playing` | The intent to play (also while buffering). |
| `currentTime`, `duration` | Seconds; `duration` is 0 until known. |
| `rate`, `volume`, `muted` | As set. |
| `ended` | Playback stopped at the end (never with `loop`). |
| `width`, `height` | The natural size, 0 until known. |
| `fullscreen`, `pictureInPicture` | Whether either is showing. |
| `error` | AVFoundation's description of a playback failure, or null. |

`remove()` ends fullscreen and picture in picture, stops playback and releases the player; it waits for commands
already accepted, is idempotent, and may be retried after a failure. Later commands reject `E_CLOSED`.

## Events

`addListener(listener)` returns a `Subscription`. Native observation runs only while a listener is added. Each event
carries the `status` after it: `playingChange`, `timeUpdate` (four times a second while playing, and after jumps),
`seek` (a seek completed), `rateChange`, `volumeChange` (volume or mute), `end`, `fullscreenChange`,
`pictureInPictureChange` and `error`. The first status after observation starts is the baseline and reports nothing;
read `getStatus()` for the initial state.

## VideoView

`VideoView` shows a player's video (an `AVPlayerLayer`) behind any children; it has no controls of its own, so render
them from the status. `contentFit` is `contain` (letterboxed, the default), `cover` or `fill`. Several views may show one
player; a view whose player is created later or removed updates itself. Rendering `VideoView` where video is
unavailable throws `E_UNSUPPORTED_PLATFORM` or `E_MODULE_UNAVAILABLE`.

## Fullscreen and picture in picture

`enterFullscreen()` shows the video in its own window, made fullscreen on the screen of the key window, and resolves
once macOS finished the transition. Escape, the window's green button or Mission Control end it as `exitFullscreen()`
does; so does closing the fullscreen window. Either way `fullscreenChange` reports it. A change while another is in
progress rejects `E_BUSY`. macOS gets five seconds for each transition: entering that takes longer rejects `E_TIMEOUT`,
and leaving that takes longer closes the window.

`startPictureInPicture()` floats the video of the `VideoView` that showed the player last
(`AVPictureInPictureController`), and resolves once the floating window shows. It rejects `E_UNAVAILABLE` when
`getPictureInPictureAvailability()` is not available (`host-restriction`: macOS does not support it here), when no
`VideoView` shows the player, or when that view is not in a window (or does not become ready within five seconds).
Closing the floating window or returning it ends picture in picture (`pictureInPictureChange`); so does unmounting
the view it came from.

## Testing

In driver mode (the in-app test driver, [test-driver.md](test-driver.md)) players play for real but always muted
(the status still reports the volume and mute you set), only local files load (`http` and `https` sources reject
`E_UNAVAILABLE`), and fullscreen and picture in picture only change the status and report their events: no window
opens and nothing takes focus.
Availability stays truthful: `getPictureInPictureAvailability()` asks AVKit, and picture in picture still needs a
`VideoView`. The Kitchen Sink plays a three-second 160×90 clip without an audio track (generated with ffmpeg's `testsrc2`,
`tests/fixtures/media/test-clip.mp4`), so automated runs are silent and need no network. `tests/media.native.mm` checks
loading, seeking, status, looping and the simulated fullscreen and picture in picture with that clip. Real fullscreen
and picture in picture are checked only by the manual flow `e2e/flows/media/video-real.yaml`.

## Platforms

| Platform | Availability |
| --- | --- |
| macOS | Available (macOS 14 and later). |
| Windows | `getVideoAvailability()` reports `unsupported-platform` and `getPictureInPictureAvailability()` resolves it; `createVideoPlayer` rejects and `VideoView` throws `E_UNSUPPORTED_PLATFORM`. `MediaPlayer`-based playback is tracked in #403. |

The Kitchen Sink's Video screen (`spark-ks://media/video`) plays the test clip with transport, rate, volume, fullscreen
and picture in picture controls and shows the status and events; its flows are in `e2e/flows/media/`.
