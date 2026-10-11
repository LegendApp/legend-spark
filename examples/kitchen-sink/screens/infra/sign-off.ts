import { useEffect, useSyncExternalStore } from "react";
import * as app from "@legendapp/spark/app";
import * as files from "@legendapp/spark/files";
import type { Signoff, SignoffDecisions, SignoffItem, SignoffSession } from "../../../../scripts/e2e/format/signoff";
import { argument, SIGNOFF_FLAG } from "../../launch";

// The manual sign-off checklist (docs/e2e-flows.md#manual-sign-offs). `bun run gate:signoff` launches the release build
// with `--ks-signoff <session.json>`; a person signs off each run, and every decision is written to the session's
// decisions file at once, which the command merges into the sign-off file when the app quits.
export type Verdict = Signoff["verdict"];
export type SignOffState =
  | { status: "loading" }
  | { status: "no-session" }
  | { status: "error"; error: string }
  | { status: "ready"; session: SignoffSession; dir: string; decisions: Readonly<Record<string, Signoff>>; saveError?: string };
/** Why a decision cannot be recorded. */
export type SignOffProblem = "not-ready" | "fail-needs-note" | "evidence-needs-note";

let state: SignOffState = { status: "loading" };
const listeners = new Set<() => void>();
function set(next: SignOffState) {
  state = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getSignOffState(): SignOffState { return state; }
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

/** `relative` against a directory, with `.` and `..` resolved: session paths are relative to the session file. */
export function resolvePath(dir: string, relative: string): string {
  const parts: string[] = [];
  for (const part of `${dir}/${relative}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function parseSession(text: string, file: string): SignoffSession {
  const session = JSON.parse(text) as Partial<SignoffSession>;
  const fields = ["target", "commit", "by", "machine", "decisions"] as const;
  if (session.version !== 1 || !Array.isArray(session.items) || fields.some(field => typeof session[field] !== "string")) {
    throw new Error(`${file} is not a sign-off session from bun run gate:signoff (version 1).`);
  }
  return session as SignoffSession;
}

let loading: Promise<void> | undefined;
/** Reads the session named by --ks-signoff once per process, and the decisions already made in it. */
export function loadSignOff(): Promise<void> {
  return loading ??= (async () => {
    try {
      const file = argument((await app.getAppContext()).launchArguments, SIGNOFF_FLAG);
      if (!file) { set({ status: "no-session" }); return; }
      const session = parseSession(await files.readText(file), file);
      const dir = file.slice(0, file.lastIndexOf("/"));
      const decisionsFile = resolvePath(dir, session.decisions);
      const made = await files.exists(decisionsFile) ? (JSON.parse(await files.readText(decisionsFile)) as SignoffDecisions).signoffs : [];
      set({ status: "ready", session, dir, decisions: Object.fromEntries(made.map(signoff => [signoff.flow, signoff])) });
    } catch (error) {
      set({ status: "error", error: describe(error) });
    }
  })();
}

/**
 * A failed sign-off needs a note saying what was wrong. A pass needs evidence: the runner's screenshots, or a note when a
 * step asks for evidence that was not captured (a `manual: true` flow never runs, so it has no screenshot).
 */
export function signOffProblem(item: SignoffItem, verdict: Verdict, note: string): SignOffProblem | undefined {
  if (!item.ready) return "not-ready";
  if (note.trim()) return undefined;
  if (verdict === "fail") return "fail-needs-note";
  if (item.steps.some(step => step.evidence !== "none" && !step.screenshot)) return "evidence-needs-note";
}

let writing = Promise.resolve();
/** Writes every decision so far. Writes run one at a time, and each writes the state current when it runs. */
function save() {
  writing = writing.then(async () => {
    if (state.status !== "ready") return;
    const { dir, session, decisions } = state;
    const body: SignoffDecisions = { version: 1, signoffs: Object.values(decisions) };
    try {
      await files.writeText(resolvePath(dir, session.decisions), `${JSON.stringify(body, null, 2)}\n`);
      if (state.status === "ready" && state.saveError) set({ ...state, saveError: undefined });
    } catch (error) {
      if (state.status === "ready") set({ ...state, saveError: describe(error) });
    }
  });
  return writing;
}

/** Signs off one run as this session's person, now. Returns the problem instead when it cannot be recorded. */
export function decide(flow: string, verdict: Verdict, note: string): SignOffProblem | undefined {
  if (state.status !== "ready") throw new Error("No sign-off session is open.");
  const { session } = state;
  const item = session.items.find(candidate => candidate.flow === flow);
  if (!item) throw new Error(`${flow} is not in this sign-off session.`);
  const problem = signOffProblem(item, verdict, note);
  if (problem) return problem;
  const evidence = item.steps.flatMap(step => step.screenshot ? [step.screenshot] : []), text = note.trim();
  const signoff: Signoff = {
    flow, target: session.target, commit: session.commit, flowHash: item.flowHash, verdict, by: session.by, machine: session.machine,
    at: new Date().toISOString(), ...(evidence.length ? { evidence } : {}), ...(text ? { note: text } : {}),
  };
  set({ ...state, decisions: { ...state.decisions, [flow]: signoff } });
  void save();
}

/** Resolves when every decision so far has been written (or failed to write; see `saveError`). */
export function flushSignOff(): Promise<void> { return writing; }

/** The sign-off a run has now: one made in this session, else the one already in the sign-off file. */
export function currentSignoff(current: Extract<SignOffState, { status: "ready" }>, item: SignoffItem): Signoff | undefined {
  return current.decisions[item.flow] ?? item.signoff;
}

export function useSignOff(): SignOffState {
  useEffect(() => { void loadSignOff(); }, []);
  return useSyncExternalStore(subscribe, getSignOffState);
}
