// The manual sign-off contract (docs/e2e-flows.md#manual-sign-offs), shared by the runner, the gate, `bun run gate:signoff`
// and the Kitchen Sink checklist (screens/infra/sign-off.ts imports these types). Types only: the app bundles none of the tooling.

/** One entry of the sign-off file (`signoffs` in e2e/gate.yaml; schema e2e/schema/signoffs.schema.json). */
export type Signoff = {
  /** The run ID from the gate report, such as flows/menus/macos-items[appearance=dark]. */
  flow: string;
  target: string;
  commit: string;
  /** SHA-256 of the flow file's content when it was signed off: the gate report's flowHash. */
  flowHash: string;
  verdict: "pass" | "fail";
  /** git user.name <user.email> of the person who signed, confirmed by them at the terminal. */
  by: string;
  /** The host name and model of the Mac (or PC) it was signed on. */
  machine: string;
  at: string;
  /** Relative to the repository root in the sign-off file; relative to the session directory in a decisions file. */
  evidence?: string[];
  note?: string;
};

/** A manualStep as the runner reached it (`partial` flows) or as the gate planned it (`manual: true` flows, which never run). */
export type ManualStep = {
  instruction: string;
  expect: string;
  evidence: "screenshot" | "recording" | "none";
  signoff: "required" | "optional";
  /** file:line:column of the manualStep. */
  location: string;
  /** `evidence: screenshot`: the in-process capture taken when the runner reached the step. */
  screenshot?: string;
};

/** One flow run that needs (or may have) a sign-off. */
export type SignoffItem = {
  flow: string;
  name: string;
  intent?: string;
  kind: "manual" | "partial";
  /** A person can sign it off: a `manual: true` flow, or a `partial` run whose automated steps passed. */
  ready: boolean;
  /** Why it is not ready. */
  reason?: string;
  steps: ManualStep[];
  /** SHA-256 of the flow file's content: what a sign-off of this run names. */
  flowHash: string;
  /** The sign-off already in the sign-off file for this target, commit and flow content. */
  signoff?: Signoff;
};

/**
 * `<sign-off dir>/manual/<commit>/session.json`, written by `bun run gate:signoff` and read by the checklist
 * (`--ks-signoff <file>`). Screenshot and decisions paths are relative to the session file's directory.
 */
export type SignoffSession = {
  version: 1;
  target: string;
  commit: string;
  by: string;
  machine: string;
  /** Where the checklist writes its SignoffDecisions. */
  decisions: string;
  items: SignoffItem[];
};

/** What the checklist writes after every decision: every sign-off made in this session, latest per run. */
export type SignoffDecisions = { version: 1; signoffs: Signoff[] };
