import path from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import { isAlias, isMap, isScalar, isSeq, LineCounter, parseAllDocuments, type Document, type Node, type Pair, type YAMLMap } from "yaml";
import { COMMANDS } from "./commands.ts";
import { NESTED } from "./primitives.ts";
import { ajv, formatProblem, validators } from "./schemas.ts";

export type SourceLocation = { file: string; line: number; column: number };
export type Diagnostic = SourceLocation & { rule: string; message: string };
export type Condition = { platform?: "macos" | "windows"; visible?: unknown; notVisible?: unknown; matrix?: Record<string, string | boolean> };
export type FlowCommand = { name: string; args: Record<string, unknown>; when?: Condition; timeout?: string | number; location: SourceLocation };
export type FlowHeader = {
  appId: string; name: string; intent?: string; checks?: string[]; tags?: string[]; platforms?: Array<"macos" | "windows">;
  build?: "release" | "dev"; manual?: boolean | "partial"; timeout?: string | number; matrix?: Record<string, Array<string | boolean>>;
  env?: Record<string, string>; onFlowStart?: FlowCommand[]; onFlowComplete?: FlowCommand[];
};
export type FlowAst = { file: string; header: FlowHeader; commands: FlowCommand[] };
export type CheckRegistry = { area: string; prefix: string; checks: Record<string, { title: string; platforms?: Array<"macos" | "windows">; blocking?: boolean; spec?: string }> };

export class FlowFormatError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join("\n"));
    this.name = "FlowFormatError";
  }
}
export const formatDiagnostic = (d: Diagnostic) => `${d.file}:${d.line}:${d.column}: ${d.message} [${d.rule}]`;

type Ranged = { range?: readonly number[] | null } | null | undefined;
export type Loaded = { file: string; lines: LineCounter; docs: Document.Parsed[]; diagnostics: Diagnostic[] };

function locate(loaded: Loaded, node: Ranged): SourceLocation {
  const { line, col } = loaded.lines.linePos(node?.range?.[0] ?? 0);
  return { file: loaded.file, line, column: col };
}
export const diagnosticAt = (loaded: Loaded, node: Ranged, rule: string, message: string): Diagnostic => ({ ...locate(loaded, node), rule, message });

/** Parse YAML documents; reports the first syntax error of each document (later ones cascade from it). */
export function load(source: string, file: string): Loaded {
  const lines = new LineCounter();
  const docs = parseAllDocuments(source, { lineCounter: lines, prettyErrors: false }) as Document.Parsed[];
  const loaded: Loaded = { file, lines, docs: Array.isArray(docs) ? docs : [], diagnostics: [] };
  for (const doc of loaded.docs) {
    const error = doc.errors[0];
    if (!error) continue;
    const at = error.pos[0];
    const hint = source[at] === "{" && source[at - 1] === "$" ? ' Quote ${VAR} inside { } and [ ], for example "${FIXTURES}/a.png".' : "";
    loaded.diagnostics.push(diagnosticAt(loaded, { range: error.pos }, "yaml", `${error.message.split("\n")[0]}.${hint}`));
  }
  return loaded;
}

const flowSchema = ajv.getSchema("flow")!.schema as { definitions: { command: { then: object; else: object } } };
const unescape = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

function nodeAt(doc: Document.Parsed, pointer: string): { node: Node | null; key?: Node } {
  let node = doc.contents as Node | null, key: Node | undefined;
  for (const segment of pointer.split("/").slice(1).map(unescape)) {
    if (isAlias(node)) node = node.resolve(doc) as Node;
    if (isMap(node)) {
      const pair = (node.items as Pair<Node, Node | null>[]).find(item => isScalar(item.key) && String(item.key.value) === segment);
      key = pair?.key; node = pair?.value ?? null;
    } else if (isSeq(node)) node = node.items[Number(segment)] as Node;
  }
  return { node, key };
}
const keyNode = (map: Node | null, name: string) => isMap(map) ? (map.items as Pair<Node>[]).find(pair => isScalar(pair.key) && pair.key.value === name)?.key : undefined;

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!; row[0] = i;
    for (let j = 1; j <= b.length; j++) [previous, row[j]] = [row[j]!, Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase() ? 0 : 1))];
  }
  return row[b.length]!;
}
export function unknownCommand(name: string): { rule: string; message: string } {
  if (/^(sleep|wait|delay|pause|waitFor\w*)$/i.test(name)) return { rule: "no-sleep", message: `"${name}" is not a command: flows never sleep. Every command waits for its target; use extendedWaitUntil, or setClock: virtual with advanceClock for animation.` };
  const best = Object.keys(COMMANDS).map(candidate => [candidate, distance(name, candidate)] as const).sort((a, b) => a[1] - b[1])[0]!;
  return { rule: "unknown-command", message: `unknown command "${name}"${best[1] <= Math.max(2, name.length / 4) ? ` (did you mean "${best[0]}"?)` : ""}` };
}

const keys = (errors: ErrorObject[]) => [...new Set(errors.map(error => `"${error.params.missingProperty}"`))].join(", ");

/** Run a compiled schema over a document and turn ajv errors into located, readable diagnostics. */
function schemaDiagnostics(loaded: Loaded, doc: Document.Parsed, validate: ValidateFunction, root: string): Diagnostic[] {
  if (validate(doc.toJS({ maxAliasCount: 100 }))) return [];
  const errors = validate.errors!.filter(error => error.keyword !== "if");
  const branchesOf = (union: ErrorObject) => errors.filter(other => other.instancePath === union.instancePath && other.keyword === "required" && other.schemaPath.startsWith(`${union.schemaPath}/`));
  const consumed = new Set(errors.filter(error => error.keyword === "anyOf" || error.keyword === "oneOf").flatMap(branchesOf));
  const out: Diagnostic[] = [];
  for (const error of errors) {
    if (consumed.has(error)) continue;
    const { node, key } = nodeAt(doc, error.instancePath);
    const label = [root, ...error.instancePath.split("/").slice(1).map(unescape).filter(segment => !/^\d+$/.test(segment))].slice(error.instancePath ? 1 : 0).join(".");
    const at = (target: Ranged, rule: string, message: string) => out.push(diagnosticAt(loaded, target ?? key ?? doc.contents ?? { range: doc.range }, rule, label ? `${label}: ${message}` : message));
    const { params, parentSchema } = error;
    if (error.keyword === "anyOf" || error.keyword === "oneOf") {
      if (Array.isArray(params.passingSchemas)) at(node, "schema", `takes only one of ${(parentSchema!.oneOf as Array<{ required: string[] }>).map(branch => `"${branch.required[0]}"`).join(", ")}`);
      else at(node, "schema", `needs one of ${keys(branchesOf(error))}`);
    } else if (error.keyword === "additionalProperties" && parentSchema === flowSchema.definitions.command.else) {
      const name = String(params.additionalProperty), problem = unknownCommand(name);
      out.push(diagnosticAt(loaded, keyNode(node, name), problem.rule, problem.message));
    } else if (error.keyword === "enum" && parentSchema === flowSchema.definitions.command.then) {
      const name = String(error.data);
      if (name in COMMANDS) at(node, "schema", `${name} needs arguments`);
      else { const problem = unknownCommand(name); at(node, problem.rule, problem.message); }
    } else if (error.keyword === "maxProperties" && parentSchema === flowSchema.definitions.command.else) {
      at(node, "schema", `one command per list item; found ${Object.keys(error.data as object).join(", ")}`);
    } else if (error.keyword === "minProperties" && parentSchema === flowSchema.definitions.command.else) {
      at(node, "schema", "empty command");
    } else if (error.keyword === "additionalProperties") {
      const allowed = Object.keys((parentSchema as { properties: object }).properties);
      at(keyNode(node, String(params.additionalProperty)), "schema", `unknown key "${params.additionalProperty}" (expected ${allowed.join(", ")})`);
    } else if (error.keyword === "propertyNames") {
      at(keyNode(node, String(params.propertyName)), "schema", `invalid key "${params.propertyName}"`);
    } else if (error.keyword === "pattern" && error.propertyName) {
      continue; // reported by the propertyNames error above
    } else if (error.keyword === "required") at(node, "schema", `missing required key "${params.missingProperty}"`);
    else if (error.keyword === "enum") at(node, "schema", `must be one of ${(params.allowedValues as unknown[]).map(value => JSON.stringify(value)).join(", ")}`);
    else if (error.keyword === "type") at(node, "schema", `must be ${String(params.type).replace(",", " or ")}`);
    else if (error.keyword === "pattern") at(node, "schema", `${JSON.stringify(error.data)} is not ${(parentSchema as { description?: string }).description ?? `matching ${params.pattern}`}`);
    else if (error.keyword === "format") at(node, "schema", `${JSON.stringify(error.data)} is not a valid ${params.format}: ${formatProblem(String(params.format), String(error.data))}`);
    else at(node, "schema", error.message!);
  }
  return out;
}

function documents(loaded: Loaded, count: number, layout: string): boolean {
  if (loaded.diagnostics.length) return false;
  if (loaded.docs.length === count) return true;
  loaded.diagnostics.push(diagnosticAt(loaded, loaded.docs[count] ? { range: loaded.docs[count]!.range } : undefined, "structure", `expected ${layout}; found ${loaded.docs.length} YAML document(s)`));
  return false;
}

type Context = { loaded: Loaded; doc: Document.Parsed };
const deref = (ctx: Context, node: unknown) => (isAlias(node) ? node.resolve(ctx.doc) : node) as Node;

function toCommand(ctx: Context, raw: unknown, data: unknown): FlowCommand {
  const node = deref(ctx, raw);
  if (typeof data === "string") return { name: data, args: {}, location: locate(ctx.loaded, node) };
  const pair = (node as YAMLMap<Node, Node | null>).items[0]!;
  const [name, value] = Object.entries(data as Record<string, unknown>)[0]!;
  const spec = COMMANDS[name]!;
  const args: Record<string, unknown> = value == null ? {} : typeof value === "object" && !Array.isArray(value) ? { ...value } : { [spec.shorthand!]: value };
  const command: FlowCommand = { name, args, location: locate(ctx.loaded, pair.key) };
  for (const field of ["when", "timeout"] as const) if (!(field in spec.props) && field in args) { (command as Record<string, unknown>)[field] = args[field]; delete args[field]; }
  for (const [field, schema] of Object.entries(spec.props)) {
    const arity = NESTED.get(schema), child = args[field];
    if (!arity || child === undefined) continue;
    const childNode = deref(ctx, (deref(ctx, pair.value) as YAMLMap).get(field, true));
    args[field] = arity === "one" ? toCommand(ctx, childNode, child) : (child as unknown[]).map((item, index) => toCommand(ctx, (childNode as unknown as { items: unknown[] }).items[index], item));
  }
  return command;
}
const toCommands = (ctx: Context, node: unknown, data: unknown[]) => data.map((item, index) => toCommand(ctx, (deref(ctx, node) as unknown as { items: unknown[] }).items[index], item));

function* walk(commands: FlowCommand[]): Generator<FlowCommand> {
  for (const command of commands) {
    yield command;
    for (const value of Object.values(command.args)) {
      if (Array.isArray(value) && value.every(item => item && typeof item === "object" && "location" in item)) yield* walk(value as FlowCommand[]);
      else if (value && typeof value === "object" && "location" in value && "name" in value) yield* walk([value as FlowCommand]);
    }
  }
}

/** `when: { matrix }` may only name dimensions and values the header matrix declares. */
function matrixDiagnostics(flow: FlowAst): Diagnostic[] {
  const all = [...flow.header.onFlowStart ?? [], ...flow.commands, ...flow.header.onFlowComplete ?? []];
  return [...walk(all)].flatMap(command => Object.entries(command.when?.matrix ?? {}).flatMap(([dimension, value]) => {
    const values = flow.header.matrix?.[dimension];
    const message = !values ? `when.matrix.${dimension}: the header matrix has no ${dimension} dimension` : !values.includes(value) ? `when.matrix.${dimension}: ${JSON.stringify(value)} is not in the header matrix (${values.map(item => JSON.stringify(item)).join(", ")})` : undefined;
    return message ? [{ ...command.location, rule: "schema", message: `${command.name} ${message}` }] : [];
  }));
}

export type Checked<T> = { loaded: Loaded; diagnostics: Diagnostic[]; value?: T };

export function checkFlow(source: string, file = "<flow>"): Checked<FlowAst> {
  const loaded = load(source, file);
  if (!documents(loaded, 2, "a header, `---`, then a command list")) return { loaded, diagnostics: loaded.diagnostics };
  const [headerDoc, commandDoc] = loaded.docs as [Document.Parsed, Document.Parsed];
  const diagnostics = [...schemaDiagnostics(loaded, headerDoc, validators.header, "header"), ...schemaDiagnostics(loaded, commandDoc, validators.commands, "commands")];
  if (diagnostics.length) return { loaded, diagnostics };
  const headerData = headerDoc.toJS() as FlowHeader & { onFlowStart?: unknown[]; onFlowComplete?: unknown[] };
  const header: FlowHeader = { ...headerData, onFlowStart: undefined, onFlowComplete: undefined };
  for (const hook of ["onFlowStart", "onFlowComplete"] as const) {
    if (headerData[hook]) header[hook] = toCommands({ loaded, doc: headerDoc }, (headerDoc.contents as YAMLMap).get(hook, true), headerData[hook]!);
    else delete header[hook];
  }
  const flow: FlowAst = { file, header, commands: toCommands({ loaded, doc: commandDoc }, commandDoc.contents, commandDoc.toJS() as unknown[]) };
  const semantic = matrixDiagnostics(flow);
  return semantic.length ? { loaded, diagnostics: semantic } : { loaded, diagnostics: [], value: flow };
}

export function checkSubflow(source: string, file = "<subflow>"): Checked<FlowCommand[]> {
  const loaded = load(source, file);
  if (!documents(loaded, 1, "one command list (subflows have no header)")) return { loaded, diagnostics: loaded.diagnostics };
  const doc = loaded.docs[0]!;
  const diagnostics = schemaDiagnostics(loaded, doc, validators.commands, "commands");
  return diagnostics.length ? { loaded, diagnostics } : { loaded, diagnostics, value: toCommands({ loaded, doc }, doc.contents, doc.toJS() as unknown[]) };
}

export function checkRegistry(source: string, file = "<area>.yaml"): Checked<CheckRegistry> {
  const loaded = load(source, file);
  if (!documents(loaded, 1, "one check registry document")) return { loaded, diagnostics: loaded.diagnostics };
  const doc = loaded.docs[0]!;
  const diagnostics = schemaDiagnostics(loaded, doc, validators.registry, "");
  if (diagnostics.length) return { loaded, diagnostics };
  const registry = doc.toJS() as CheckRegistry;
  const area = path.basename(file).replace(/\.ya?ml$/, "");
  if (registry.area !== area) diagnostics.push(diagnosticAt(loaded, (doc.contents as YAMLMap).get("area", true) as Node, "schema", `area "${registry.area}" must match the file name ${area}.yaml (one registry file per area)`));
  const checks = (doc.contents as YAMLMap).get("checks", true) as Node;
  for (const id of Object.keys(registry.checks)) if (!id.startsWith(`${registry.prefix}-`)) diagnostics.push(diagnosticAt(loaded, keyNode(checks, id), "schema", `check ID "${id}" must start with the area prefix ${registry.prefix}-`));
  return diagnostics.length ? { loaded, diagnostics } : { loaded, diagnostics, value: registry };
}

export function checkGate(source: string, file = "gate.yaml"): Checked<unknown> {
  const loaded = load(source, file);
  if (!documents(loaded, 1, "one gate manifest document")) return { loaded, diagnostics: loaded.diagnostics };
  const diagnostics = schemaDiagnostics(loaded, loaded.docs[0]!, validators.gate, "");
  return diagnostics.length ? { loaded, diagnostics } : { loaded, diagnostics, value: loaded.docs[0]!.toJS() };
}

const orThrow = <T>(checked: Checked<T>): T => { if (checked.diagnostics.length) throw new FlowFormatError(checked.diagnostics); return checked.value!; };
/** Parse a flow: header, `---`, then a command list. Throws FlowFormatError with every located problem. */
export const parseFlow = (source: string, file?: string) => orThrow(checkFlow(source, file));
/** Parse a subflow: one command list. */
export const parseSubflow = (source: string, file?: string) => orThrow(checkSubflow(source, file));
export const parseCheckRegistry = (source: string, file?: string) => orThrow(checkRegistry(source, file));

