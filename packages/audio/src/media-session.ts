import Native from "./NativeSparkAudio";
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
  let stopped = false, removed = false, removal: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const call = async <T>(method: string, args: object, validate: (value: unknown) => value is T) => parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify({ id, ...args }))), validate);
  const command = async (method: string, args = {}) => { await call(method, args, (value): value is null => value === null); };
  const stop = () => { stopped = true; clearTimeout(timer); };
  await enqueue(async () => {
    try { await command("sessionCreate", state); }
    catch (cause) {
      try { await command("sessionRemove"); } catch (cleanup) { throw new SparkError("E_NATIVE", "Media creation and cleanup failed", { cause: new AggregateError([cause, cleanup]) }); }
      throw cause;
    }
    owner?.(); owner = stop;
  });
  async function poll() {
    try {
      const commands = await enqueue(async () => owner !== stop || stopped ? [] : call("sessionCommands", {}, (value): value is MediaCommand[] => Array.isArray(value) && value.every(validMediaCommand)));
      for (const event of commands) {
        if (stopped || owner !== stop) break;
        try { onCommand(event); } catch (error) { onError(error); }
      }
    } catch (error) { if (!stopped) { stop(); onError(error); } }
    finally { if (!stopped && owner === stop) timer = setTimeout(() => { void poll().catch(console.error); }, 100); }
  }
  void poll().catch(console.error);
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
