import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createAudioPlayer } from "./index";
import type { AudioPlayer, AudioPlayerOptions, AudioSource } from "./types";

export type AudioPlayerState = { status: "loading" } | { status: "ready"; player: AudioPlayer } | { status: "error"; error: unknown };
export interface AudioPlayerHookOptions extends AudioPlayerOptions {
  /** Cleanup failures cannot update an unmounted component. The player permits retry. */
  onCleanupError?(error: unknown, player: AudioPlayer): void;
}
/** Owns one player for this source. Creation occurs in an effect, never during render. */
export function useAudioPlayer(source: AudioSource, options: AudioPlayerHookOptions = {}): AudioPlayerState {
  const { uri, title } = source;
  const { loadTimeoutMs, signal, onCleanupError } = options;
  const cleanupError = useRef(onCleanupError);
  useLayoutEffect(() => { cleanupError.current = onCleanupError; }, [onCleanupError]);
  const [current, setCurrent] = useState<{ uri: string; title?: string; loadTimeoutMs?: number; signal?: AbortSignal; state: AudioPlayerState }>();
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false, player: AudioPlayer | undefined;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const set = (state: AudioPlayerState) => { if (!disposed) setCurrent({ uri, title, loadTimeoutMs, signal, state }); };
    const remove = (value: AudioPlayer) => { void value.remove().catch(error => { if (cleanupError.current) cleanupError.current(error, value); else console.error(error); }); };
    set({ status: "loading" });
    void createAudioPlayer({ uri, title }, { loadTimeoutMs, signal: controller.signal }).then(value => {
      if (disposed) remove(value);
      else { player = value; set({ status: "ready", player }); }
    }, error => set({ status: "error", error }));
    return () => { disposed = true; controller.abort(); signal?.removeEventListener("abort", abort); if (player) remove(player); };
  }, [uri, title, loadTimeoutMs, signal]);
  return current && current.uri === uri && current.title === title && current.loadTimeoutMs === loadTimeoutMs && current.signal === signal ? current.state : { status: "loading" };
}
