import { useCallback, useEffect, useRef, useState } from "react";
import { SparkError, type Availability } from "@legendapp/spark/contracts";
import * as files from "@legendapp/spark/files";
import { createVideoPlayer, getPictureInPictureAvailability, getVideoAvailability, type VideoPlayer, type VideoPlayerEvent, type VideoStatus } from "@legendapp/spark/video";
import { TEST_CLIP_BASE64 } from "./test-clip";

/** Results show codes only, so flows can assert them in any locale. */
export const describeFailure = (cause: unknown) => cause instanceof SparkError ? `SparkError:${cause.code}` : String(cause);
const seconds = (value: number) => value.toFixed(2);
/** "paused · 0.00/3.00 s · rate 1 · volume 1 · 160×90": API data, not translated. */
export const describeStatus = (status: VideoStatus) => [
  `${status.playing ? "playing" : status.ended ? "ended" : "paused"} · ${seconds(status.currentTime)}/${seconds(status.duration)} s`,
  `rate ${status.rate} · volume ${status.volume}${status.muted ? " muted" : ""} · ${status.width}×${status.height}`,
  `fullscreen ${status.fullscreen ? "on" : "off"} · picture in picture ${status.pictureInPicture ? "on" : "off"}`,
].join(" · ");
/** timeUpdate is in the status line; the list keeps the discrete events. */
const describeEvent = (event: VideoPlayerEvent): string | undefined => {
  switch (event.type) {
    case "timeUpdate": return undefined;
    case "playingChange": return `playingChange ${event.playing}`;
    case "seek": return `seek ${seconds(event.currentTime)}`;
    case "rateChange": return `rateChange ${event.rate}`;
    case "volumeChange": return `volumeChange ${event.volume}${event.muted ? " muted" : ""}`;
    case "end": return "end";
    case "fullscreenChange": return `fullscreenChange ${event.fullscreen}`;
    case "pictureInPictureChange": return `pictureInPictureChange ${event.pictureInPicture}`;
    case "error": return `error ${event.error}`;
  }
};
const KEEP = 6;
export type VideoAction = "play" | "pause" | "seek" | "nearEnd" | "rate" | "volume" | "mute" | "enterFullscreen" | "exitFullscreen" | "startPip" | "stopPip";
export type VideoEventEntry = { key: number; text: string };

/** Writes the bundled silent clip to a temporary file once per launch; resolves its path. */
let clip: Promise<string> | undefined;
function clipPath() {
  return clip ??= files.getDirectory("temp").then(async directory => {
    const path = `${directory.replace(/\/$/, "")}/spark-kitchen-sink-test-clip.mp4`;
    await files.writeBytes(path, Uint8Array.from(atob(TEST_CLIP_BASE64), character => character.charCodeAt(0)));
    return path;
  });
}

/**
 * The silent test clip in a player owned by the screen, through @legendapp/spark/video. Opening the screen loads it
 * paused; nothing plays until Play. In a test-driver run fullscreen and picture in picture only change the status
 * (docs/video.md#testing), so no window opens.
 */
export function useVideoDemo() {
  const [player, setPlayer] = useState<VideoPlayer | null>(null);
  const [status, setStatus] = useState<string>();
  const [events, setEvents] = useState<readonly VideoEventEntry[]>([]);
  const [result, setResult] = useState<string>();
  const [pictureInPicture, setPictureInPicture] = useState<Availability>();
  const received = useRef(0);

  useEffect(() => {
    let active = true, owned: VideoPlayer | undefined;
    getPictureInPictureAvailability().then(value => { if (active) setPictureInPicture(value); }, cause => { if (active) setResult(describeFailure(cause)); });
    // Where video is unavailable the clip is not written: creating the player shows the typed error.
    (getVideoAvailability().available ? clipPath() : Promise.resolve("/spark-kitchen-sink-test-clip.mp4")).then(path => createVideoPlayer({ uri: path })).then(async created => {
      if (!active) { await created.remove(); return; }
      owned = created;
      created.addListener(event => {
        setStatus(describeStatus(event.status));
        const text = describeEvent(event);
        if (text) setEvents(list => [{ key: ++received.current, text }, ...list].slice(0, KEEP));
      });
      setStatus(describeStatus(await created.getStatus()));
      setPlayer(created);
    }).catch(cause => { if (active) setStatus(describeFailure(cause)); });
    return () => { active = false; void owned?.remove().catch(console.error); };
  }, []);

  const run = useCallback(async (action: VideoAction) => {
    if (!player) return;
    try {
      const current = await player.getStatus();
      switch (action) {
        case "play": await player.play(); break;
        case "pause": await player.pause(); break;
        case "seek": await player.seekTo(1.5); break;
        case "nearEnd": await player.seekTo(2.5); break;
        case "rate": await player.setRate(current.rate === 1 ? 2 : 1); break;
        case "volume": await player.setVolume(current.volume === 1 ? 0.5 : 1); break;
        case "mute": await player.setMuted(!current.muted); break;
        case "enterFullscreen": await player.enterFullscreen(); break;
        case "exitFullscreen": await player.exitFullscreen(); break;
        case "startPip": await player.startPictureInPicture(); break;
        case "stopPip": await player.stopPictureInPicture(); break;
      }
      setResult(`${action}: done`);
      setStatus(describeStatus(await player.getStatus()));
    } catch (cause) { setResult(`${action}: ${describeFailure(cause)}`); }
  }, [player]);

  return { availability: getVideoAvailability(), pictureInPicture, player, status, events, result, run };
}
