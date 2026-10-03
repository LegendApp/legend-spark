import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createAudioPlayer } from "./index";
import type { AudioPlayer, AudioPlayerOptions, AudioSource } from "./types";

export type AudioPlayerState = { status: "loading" } | { status: "ready"; player: AudioPlayer } | { status: "error"; error: unknown };
export interface AudioPlayerHookOptions extends AudioPlayerOptions {
  /** Cleanup failures cannot update an unmounted component. The player permits retry. */
  onCleanupError?(error: unknown, player: AudioPlayer): void;
}
type OwnedPlayer = { player: AudioPlayer; removing?: Promise<void> };
type Lifecycle = { tail: Promise<void>; owner?: OwnedPlayer };
/** Owns one player for this source. Creation occurs in an effect, never during render. */
export function useAudioPlayer(source: AudioSource, options: AudioPlayerHookOptions = {}): AudioPlayerState {
  const { uri, title } = source;
  const { loadTimeoutMs, signal, onCleanupError } = options;
  const cleanupError = useRef(onCleanupError);
  const lifecycleRef = useRef<Lifecycle | null>(null);
  if (!lifecycleRef.current) lifecycleRef.current = { tail: Promise.resolve() };
  const lifecycle = lifecycleRef.current;
  useLayoutEffect(() => { cleanupError.current = onCleanupError; }, [onCleanupError]);
  const [current, setCurrent] = useState<{ uri: string; title?: string; loadTimeoutMs?: number; signal?: AbortSignal; state: AudioPlayerState }>();
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false, owned: OwnedPlayer | undefined;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const set = (state: AudioPlayerState) => { if (!disposed) setCurrent({ uri, title, loadTimeoutMs, signal, state }); };
    set({ status: "loading" });
    const remove = (owner: OwnedPlayer) => {
      if (!owner.removing) owner.removing = owner.player.remove().then(() => {
        if (lifecycle.owner === owner) lifecycle.owner = undefined;
      }).catch(error => {
        try {
          if (cleanupError.current) cleanupError.current(error, owner.player);
          else console.error(error, owner.player);
        } catch (callbackError) { console.error(callbackError); }
        throw error;
      }).finally(() => { owner.removing = undefined; });
      return owner.removing;
    };
    const creation = lifecycle.tail.then(async () => {
      if (disposed) return;
      try {
        if (lifecycle.owner) await remove(lifecycle.owner);
      } catch (error) { set({ status: "error", error }); return; }
      if (disposed) return;
      try {
        const player = await createAudioPlayer({ uri, title }, { loadTimeoutMs, signal: controller.signal });
        owned = { player };
        lifecycle.owner = owned;
        if (!disposed) set({ status: "ready", player });
      } catch (error) { set({ status: "error", error }); }
    });
    lifecycle.tail = creation;
    return () => {
      disposed = true;
      controller.abort();
      signal?.removeEventListener("abort", abort);
      const cleanup = creation.then(async () => { if (owned) await remove(owned).catch(() => {}); });
      lifecycle.tail = cleanup;
    };
  }, [uri, title, loadTimeoutMs, signal]);
  return current && current.uri === uri && current.title === title && current.loadTimeoutMs === loadTimeoutMs && current.signal === signal ? current.state : { status: "loading" };
}
