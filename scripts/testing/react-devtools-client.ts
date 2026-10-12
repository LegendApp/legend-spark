// A headless React DevTools frontend for one debug target (scripts/test-react-devtools.ts): it speaks the React
// DevTools bridge over CDP the way React Native DevTools' Components and Profiler panels do. React Native's
// setUpReactDevTools connects its backend (react-devtools-core) through the Fusebox dispatcher: the frontend adds the
// dispatcher's binding, initializes the `react-devtools` domain, receives the backend's messages as
// Runtime.bindingCalled events and sends its own through __FUSEBOX_REACT_DEVTOOLS_DISPATCHER__.sendMessage.
import type { Cdp } from "./dev-session.ts";

/** One element of the component tree, as the backend's `operations` messages describe it. */
export type Element = { id: number; rendererID: number; root: number; type: number; parent: number; owner: number; name: string | null; key: string | null; children: number[] };
export type BridgeMessage = { event: string; payload: any };

// react-devtools-shared/src/constants.js and types.js (bridge protocol 2, react-devtools-core 6.1).
const ADD = 1, REMOVE = 2, REORDER = 3, BASE_DURATION = 4, ERRORS = 5, REMOVE_ROOT = 6, SUBTREE_MODE = 7;
export const ROOT = 11;

export async function connectReactDevTools(cdp: Cdp, until: <T>(check: () => Promise<T | undefined | false>, label: string, timeout?: number) => Promise<T>) {
  const messages: BridgeMessage[] = [];
  const elements = new Map<number, Element>();
  /** Roots by id, with their renderer. */
  const roots = new Map<number, number>();
  let seen = 0;

  /** Applies the backend's `operations` (react-devtools-shared/src/devtools/store.js onBridgeOperations). */
  function apply(operations: number[]) {
    const [rendererID, root] = operations as [number, number];
    let i = 2;
    const strings: (string | null)[] = [null];
    const end = i + 1 + operations[i]!;
    for (i++; i < end;) {
      const length = operations[i++]!;
      strings.push(String.fromCodePoint(...operations.slice(i, i + length)));
      i += length;
    }
    while (i < operations.length) {
      switch (operations[i]) {
        case ADD: {
          const id = operations[i + 1]!, type = operations[i + 2]!;
          i += 3;
          if (type === ROOT) {
            roots.set(id, rendererID);
            elements.set(id, { id, rendererID, root: id, type, parent: 0, owner: 0, name: null, key: null, children: [] });
            i += 4; // isStrictModeCompliant, supportsProfiling, supportsStrictMode, hasOwnerMetadata
          } else {
            const [parent, owner, name, key] = operations.slice(i, i + 4) as [number, number, number, number];
            i += 4;
            elements.set(id, { id, rendererID, root, type, parent, owner, name: strings[name] ?? null, key: strings[key] ?? null, children: [] });
            elements.get(parent)?.children.push(id);
          }
          break;
        }
        case REMOVE: {
          const count = operations[i + 1]!;
          for (const id of operations.slice(i + 2, i + 2 + count)) {
            const element = elements.get(id);
            const parent = element && elements.get(element.parent);
            if (parent) parent.children = parent.children.filter(child => child !== id);
            elements.delete(id);
          }
          i += 2 + count;
          break;
        }
        case REORDER: {
          const id = operations[i + 1]!, count = operations[i + 2]!;
          const element = elements.get(id);
          if (element) element.children = operations.slice(i + 3, i + 3 + count);
          i += 3 + count;
          break;
        }
        case BASE_DURATION: i += 3; break;
        case ERRORS: i += 4; break;
        case REMOVE_ROOT: {
          roots.delete(root);
          for (const [id, element] of elements) if (element.root === root) elements.delete(id);
          i += 1;
          break;
        }
        case SUBTREE_MODE: i += 3; break;
        default: throw new Error(`Unknown React DevTools operation ${operations[i]} at ${i}`);
      }
    }
  }

  /** Reads the backend's messages that arrived since the last call into `messages`, applying `operations`. */
  function drain() {
    const events = cdp.events.filter(message => message.method === "Runtime.bindingCalled");
    for (const event of events.slice(seen)) {
      const { domain, message } = JSON.parse(event.params.payload) as { domain: string; message: BridgeMessage };
      if (domain !== "react-devtools") continue;
      messages.push(message);
      if (message.event === "operations") apply(message.payload);
    }
    seen = events.length;
  }

  const name = await cdp.evaluate("__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__.BINDING_NAME") as string;
  await cdp.send("Runtime.addBinding", { name });
  await cdp.evaluate("void __FUSEBOX_REACT_DEVTOOLS_DISPATCHER__.initializeDomain('react-devtools')");

  /** Sends a frontend message to the backend. */
  async function send(event: string, payload?: unknown) {
    await cdp.evaluate(`__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__.sendMessage('react-devtools', ${JSON.stringify(JSON.stringify({ event, payload }))})`);
  }
  /** The first backend message `event` from index `since` on that matches. */
  function next(event: string, match: (payload: any) => boolean = () => true, since = 0, timeout = 20000) {
    return until(async () => { drain(); return messages.slice(since).find(message => message.event === event && match(message.payload)); }, `React DevTools backend message ${event}`, timeout).then(message => message.payload);
  }
  /** Waits until the tree has an element `match` finds. */
  function element(match: (element: Element) => boolean, label: string, timeout = 20000) {
    return until(async () => { drain(); return [...elements.values()].find(match); }, `React DevTools element ${label}`, timeout);
  }
  let requestID = 0;
  /** inspectElement: the element's full data (props, state, hooks, owners), dehydrated as the backend sends it. */
  async function inspect(item: Element, path: (string | number)[] | null = null) {
    const id = ++requestID, since = messages.length;
    await send("inspectElement", { id: item.id, rendererID: item.rendererID, path, forceFullData: true, requestID: id });
    const reply = await next("inspectedElement", payload => payload.responseID === id, since);
    if (reply.type !== "full-data" && reply.type !== "hydrated-path") throw new Error(`inspectElement ${item.name}: ${JSON.stringify(reply).slice(0, 400)}`);
    return reply.value;
  }
  /** The element's chain of parents up to its root, nearest first. */
  const ancestors = (item: Element) => {
    const chain: Element[] = [];
    for (let parent = elements.get(item.parent); parent; parent = elements.get(parent.parent)) chain.push(parent);
    return chain;
  };

  return {
    messages, elements, roots, send, next, element, inspect, ancestors,
    /** The index of the next message, to wait for replies to what is sent after. */
    mark: () => { drain(); return messages.length; },
  };
}
