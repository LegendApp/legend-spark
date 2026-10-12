// Source-maps a Hermes sampling profile through the development server's /symbolicate endpoint (Metro's, which
// LogBox uses for stack traces), so each frame names its source file and line rather than a position in the bundle.
import type { CallFrame, CpuProfile } from "./trace";

export type Post = (url: string, body: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
/**
 * `applied`: the server's source maps mapped at least one frame (a position they do not cover, such as a module wrapper,
 * keeps its place in the bundle). `unavailable`: none was mapped, and `reason` says why.
 */
export type SourceMaps = { sourceMaps: "applied" } | { sourceMaps: "unavailable"; reason: string };
type Frame = { file: string; lineNumber: number; column: number; methodName: string };
/** Metro answers `lineNumber: null` for a position its source maps do not cover (module wrappers, `global`). */
type Mapped = { file: string; lineNumber: number | null; column: number | null };

const isFrame = (value: unknown): value is Mapped => {
  const frame = value as Partial<Mapped> | null;
  const position = (item: unknown) => item === null || Number.isInteger(item);
  return !!frame && typeof frame.file === "string" && position(frame.lineNumber) && position(frame.column);
};
/** Hermes numbers a frame's line and column from 1; the DevTools profile format from 0. */
const fromHermes = (frame: CallFrame): CallFrame => ({ ...frame, lineNumber: Math.max(0, frame.lineNumber - 1), columnNumber: Math.max(0, frame.columnNumber - 1) });

function withFrames(profile: CpuProfile, map: (frame: CallFrame) => CallFrame): CpuProfile {
  return { ...profile, nodes: profile.nodes.map(node => ({ ...node, callFrame: map(node.callFrame) })) };
}

/**
 * The profile with lines and columns from 0, its bundle frames mapped to their sources when `server` (the development
 * server's origin, ending in `/`) answers. Metro takes lines from 1 and columns from 0, and answers the same way.
 */
export async function symbolicate(profile: CpuProfile, server: string | undefined, post: Post): Promise<{ profile: CpuProfile } & SourceMaps> {
  const keys = new Map<string, number>(), stack: Frame[] = [];
  const key = (frame: CallFrame) => `${frame.url}:${frame.lineNumber}:${frame.columnNumber}`;
  for (const { callFrame } of profile.nodes) {
    if (!/^https?:/.test(callFrame.url) || keys.has(key(callFrame))) continue;
    keys.set(key(callFrame), stack.length);
    stack.push({ file: callFrame.url, lineNumber: callFrame.lineNumber, column: Math.max(0, callFrame.columnNumber - 1), methodName: callFrame.functionName });
  }
  const unmapped = (reason: string) => ({ profile: withFrames(profile, fromHermes), sourceMaps: "unavailable" as const, reason });
  if (!stack.length) return unmapped("the profile has no frames from a bundle");
  if (!server) return unmapped("the JavaScript did not come from a development server");
  let mapped: unknown;
  try {
    const response = await post(`${server}symbolicate`, JSON.stringify({ stack }));
    if (!response.ok) return unmapped(`${server}symbolicate answered ${response.status}`);
    mapped = (await response.json() as { stack?: unknown })?.stack;
  } catch (error) {
    return unmapped(`${server}symbolicate failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(mapped) || mapped.length !== stack.length || !mapped.every(isFrame)) return unmapped(`${server}symbolicate answered with another stack`);
  const frames = mapped as Mapped[];
  if (!frames.some(frame => typeof frame.lineNumber === "number")) return unmapped(`the source maps cover none of the profile's ${frames.length} bundle frames`);
  return {
    profile: withFrames(profile, frame => {
      const index = keys.get(key(frame));
      const { file, lineNumber, column } = index === undefined ? {} as Partial<Mapped> : frames[index]!;
      // Positions the source maps do not cover keep their place in the bundle.
      if (typeof lineNumber !== "number") return fromHermes(frame);
      return { ...frame, url: file!, lineNumber: Math.max(0, lineNumber - 1), columnNumber: Math.max(0, column ?? 0) };
    }),
    sourceMaps: "applied",
  };
}
