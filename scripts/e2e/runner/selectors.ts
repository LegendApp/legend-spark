// Selector semantics shared by every backend (docs/e2e-flows.md#selectors). Backends find elements by atom; this
// module composes window, within, relations, index and point on top, and explains misses.
import { distance } from "../format/parser.ts";
import { Failure, type Atom, type Candidate, type Element, type Platform, type Point, type QueryScope, type Rect, type TextMatch, type WindowInfo } from "./backend.ts";

export type WindowSelector = "key" | "main" | { title?: TextMatch; index?: number; type?: string; id?: string };
const RELATIONS = ["below", "above", "leftOf", "rightOf"] as const;
type Relation = typeof RELATIONS[number];
export type Selector = {
  source: unknown;
  atom: Atom;
  within?: Selector;
  window?: WindowSelector;
  relations: Array<{ kind: Relation; anchor: Selector }>;
  index?: number;
  point?: string;
};
/** How a backend's elements are found: by atom within a scope, and its windows. */
export type Finder = { find(atom: Atom, scope: QueryScope): Promise<Element[]>; windows(): Promise<WindowInfo[]> };
/** `problem` names the inner part (window, within, anchor) that did not match exactly one element. */
export type Located = { matches: Element[]; point?: Point; problem?: { part: unknown; found: Element[] } };

const textMatch = (value: string): TextMatch => value.length > 2 && value.startsWith("/") && value.endsWith("/") ? { kind: "regex", source: value.slice(1, -1) } : { kind: "text", value };

function platformText(value: unknown, platform: Platform, key: string): TextMatch {
  if (typeof value === "string") return textMatch(value);
  const text = (value as Partial<Record<Platform, string>>)[platform];
  if (text === undefined) throw new Failure("invalid", `${key} has no ${platform} variant: ${JSON.stringify(value)}`);
  return textMatch(text);
}

/** Turns a selector value from a flow (a string, or a mapping of selector keys) into a Selector for `platform`. */
export function parseSelector(value: unknown, platform: Platform): Selector {
  if (typeof value === "string") return { source: value, atom: { text: textMatch(value) }, relations: [] };
  const raw = value as Record<string, unknown>;
  const atom: Atom = {};
  if (raw.id !== undefined) atom.id = String(raw.id);
  if (raw.role !== undefined) atom.role = String(raw.role);
  if (raw.label !== undefined) atom.label = platformText(raw.label, platform, "label");
  if (raw.text !== undefined) atom.text = platformText(raw.text, platform, "text");
  return {
    source: value, atom, window: raw.window === undefined ? undefined : parseWindow(raw.window, platform),
    within: raw.within === undefined ? undefined : parseSelector(raw.within, platform),
    relations: RELATIONS.filter(kind => raw[kind] !== undefined).map(kind => ({ kind, anchor: parseSelector(raw[kind], platform) })),
    index: raw.index as number | undefined,
    point: raw.point as string | undefined,
  };
}

export function matchesText(match: TextMatch, value: string | undefined): boolean {
  if (value === undefined) return false;
  return match.kind === "regex" ? new RegExp(match.source, "u").test(value) : value.trim() === match.value.trim();
}

/** Atom semantics: `id` and `role` are exact, `text` and `label` are exact after trimming, or a /regex/ search. */
export function matchesAtom(element: Element, atom: Atom): boolean {
  return (atom.id === undefined || element.id === atom.id) && (atom.role === undefined || element.role === atom.role)
    && (atom.label === undefined || matchesText(atom.label, element.label)) && (atom.text === undefined || matchesText(atom.text, element.text));
}

/** Atom and scope matching over a full element list; used for backends that implement `elements()`. */
export function filterElements(elements: Element[], atom: Atom, scope: QueryScope): Element[] {
  const byKey = new Map(elements.map(element => [element.key, element]));
  const inside = (element: Element) => {
    for (let parent = element.parent; parent !== undefined; parent = byKey.get(parent)?.parent) if (parent === scope.within!.key) return true;
    return false;
  };
  return elements.filter(element => (scope.window === undefined || element.window === scope.window) && (!scope.within || inside(element)) && matchesAtom(element, atom));
}

/** `key`, `main`, or `{ title, index, type, id }` from a flow. */
export function parseWindow(value: unknown, platform: Platform): WindowSelector {
  if (typeof value === "string") return value as WindowSelector;
  const { title, ...rest } = value as Record<string, unknown>;
  return { ...rest, ...(title === undefined ? {} : { title: platformText(title, platform, "window.title") }) } as WindowSelector;
}

/** Windows matching a selector. `index` counts among the matches, front to back. */
export function pickWindows(selector: WindowSelector, windows: WindowInfo[]): WindowInfo[] {
  if (selector === "key") return windows.filter(window => window.key);
  if (selector === "main") return windows.filter(window => window.main);
  const found = windows.filter(window => (selector.id === undefined || window.id === selector.id) && (selector.type === undefined || window.type === selector.type)
    && (selector.title === undefined || matchesText(selector.title, window.title)));
  return selector.index === undefined ? found : found.slice(selector.index, selector.index + 1);
}

const windowElement = (window: WindowInfo): Element => ({ key: `window:${window.id}`, window: window.id, role: "window", label: window.title, frame: window.frame });
export const center = (frame: Rect): Point => ({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });

/** `"50%,20%"` is a percentage of the frame; `"120,48"` is points from its top-left corner. */
function parsePoint(point: string, frame: Rect): Point {
  const [x, y] = point.split(",").map(part => part.trim());
  const axis = (value: string, origin: number, size: number) => value.endsWith("%") ? origin + size * Number(value.slice(0, -1)) / 100 : origin + Number(value);
  return { x: axis(x!, frame.x, frame.width), y: axis(y!, frame.y, frame.height) };
}

/** Whether `element`'s center lies beyond the anchor's edge in the relation's direction (screen coordinates, y down). */
function related(kind: Relation, element: Rect, anchor: Rect): boolean {
  const c = center(element);
  if (kind === "below") return c.y >= anchor.y + anchor.height;
  if (kind === "above") return c.y <= anchor.y;
  if (kind === "rightOf") return c.x >= anchor.x + anchor.width;
  return c.x <= anchor.x;
}
const gap = (a: Rect, b: Rect) => Math.hypot(center(a).x - center(b).x, center(a).y - center(b).y);

/**
 * One lookup, no waiting. Inner parts (window, within, relation anchors) must match exactly one element; they
 * inherit the outer window. Plain matches are in reading order (top to bottom, then left to right). With
 * relations, matches are ordered nearest first and the nearest wins. `index` picks one match from that order.
 */
export async function locate(selector: Selector, finder: Finder, inherited?: WindowInfo): Promise<Located> {
  let window = inherited;
  if (selector.window !== undefined || (selector.point !== undefined && !selector.within && !window)) {
    const windows = await finder.windows();
    const found = selector.window === undefined ? windows : pickWindows(selector.window, windows);
    if (found.length !== 1) return { matches: [], problem: { part: { window: selector.window ?? "(any)" }, found: found.map(windowElement) } };
    window = found[0];
  }
  const one = async (part: Selector): Promise<Element | Located> => {
    const located = await locate(part, finder, window);
    return located.problem ? located : located.matches.length === 1 ? located.matches[0]! : { matches: [], problem: { part: part.source, found: located.matches } };
  };
  let within: Element | undefined;
  if (selector.within) {
    const found = await one(selector.within);
    if ("matches" in found) return found;
    within = found;
  }
  if (selector.point !== undefined) {
    const box = within ?? windowElement(window!);
    return { matches: [box], point: parsePoint(selector.point, box.frame) };
  }
  let matches = await finder.find(selector.atom, { window: window?.id, within });
  if (selector.relations.length) {
    const anchors: Array<{ kind: Relation; frame: Rect; key: string }> = [];
    for (const relation of selector.relations) {
      const anchor = await one(relation.anchor);
      if ("matches" in anchor) return anchor;
      anchors.push({ kind: relation.kind, frame: anchor.frame, key: anchor.key });
    }
    const score = (element: Element) => anchors.reduce((sum, anchor) => sum + gap(element.frame, anchor.frame), 0);
    matches = matches.filter(element => anchors.every(anchor => element.key !== anchor.key && related(anchor.kind, element.frame, anchor.frame))).sort((a, b) => score(a) - score(b));
    matches = matches.slice(selector.index ?? 0, (selector.index ?? 0) + 1);
  } else {
    matches = [...matches].sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);
    if (selector.index !== undefined) matches = matches.slice(selector.index, selector.index + 1);
  }
  return { matches };
}

export const candidate = ({ key: _key, parent: _parent, ...rest }: Element): Candidate => rest;

/** Up to five elements whose id, label or text are closest to the selector's, for not-found reports. */
export function nearby(selector: Selector, elements: Element[]): Candidate[] {
  const wanted = [selector.atom.id, ...[selector.atom.label, selector.atom.text].map(match => match && (match.kind === "text" ? match.value : match.source))]
    .filter((value): value is string => !!value);
  const pool = selector.atom.role && !wanted.length ? elements.filter(element => element.role === selector.atom.role) : elements;
  const score = (element: Element) => {
    const values = [element.id, element.label, element.text].filter((value): value is string => !!value);
    if (!wanted.length) return 0;
    if (!values.length) return Infinity;
    return Math.min(...wanted.flatMap(want => values.map(value => distance(want, value) / Math.max(want.length, value.length))));
  };
  return pool.map(element => [element, score(element)] as const).filter(([, value]) => value !== Infinity)
    .sort((a, b) => a[1] - b[1]).slice(0, 5).map(([element]) => candidate(element));
}

export const describe = (source: unknown) => JSON.stringify(source);
