import Native from "./NativeSparkAudio";
import { onAudioEvent } from "./events";
import { SparkError, invokeNative, parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
import { sessionOptions, sessionSnapshot, validMediaCommand, type MediaCommand, type MediaSession, type MediaSessionOptions } from "./media-types";
let owner: (() => void) | undefined, sequence = 0;
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.catch(() => {}).then(operation); queue = result; return result;
}
/** One explicit session owns system controls. New sessions replace the previous owner. */
export async function createMediaSession(options: MediaSessionOptions): Promise<MediaSession> {
  const state = sessionOptions(options);
  const { onCommand, onError = console.error } = options;
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "Media sessions require @legendapp/spark-audio");
  const native = Native, id = `media-${Date.now()}-${++sequence}`;
  let stopped = false, removed = false, ready = false, removal: Promise<void> | undefined;
  const buffered: MediaCommand[] = [];
  const call = async <T>(method: string, args: object, validate: (value: unknown) => value is T) => parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify({ id, ...args }))), validate);
  const command = async (method: string, args = {}) => { await call(method, args, (value): value is null => value === null); };
  const stop = () => { stopped = true; buffered.length = 0; subscription.remove(); };
  const deliver = (value: unknown) => {
    if (stopped) return;
    if (!validMediaCommand(value)) { stop(); onError(new SparkError("E_INVALID_DATA", "Invalid media command")); return; }
    if (!ready) { if (buffered.length < 128) buffered.push(value); return; }
    if (owner !== stop) return;
    try { onCommand(value); } catch (error) { onError(error); }
  };
  const subscription = onAudioEvent("sparkMediaCommand", id, deliver);
  try { await enqueue(async () => {
    try { await command("sessionCreate", state); }
    catch (cause) {
      try { await command("sessionRemove"); } catch (cleanup) { throw new SparkError("E_NATIVE", "Media creation and cleanup failed", { cause: new AggregateError([cause, cleanup]) }); }
      throw cause;
    }
    owner?.(); owner = stop; ready = true;
    for (const value of buffered.splice(0)) deliver(value);
  }); } catch (error) { stop(); throw error; }
  return {
    async update(patch) {
      if (stopped || owner !== stop) throw new SparkError("E_CLOSED", "Media session has been removed or replaced");
      const snapshot = sessionSnapshot(patch);
      await enqueue(async () => {
        if (owner !== stop) throw new SparkError("E_CLOSED", "Media session has been replaced");
        await command("sessionUpdate", snapshot);
      });
    },
    remove() {
      if (removed) return Promise.resolve();
      if (removal) return removal;
      stop();
      removal = enqueue(async () => {
        if (owner === stop) { await command("sessionRemove"); owner = undefined; }
        removed = true;
      }).finally(() => { removal = undefined; });
      return removal;
    },
  };
}
