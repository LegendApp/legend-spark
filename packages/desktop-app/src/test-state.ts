import { onDesktopEvent, type DesktopEvent } from "./events";
import { callAppNative } from "./transport";
import { SparkError, type Subscription } from "./contracts";

const roots = new Map<string, () => unknown>();
let requests: Subscription | undefined;
const NAME = /^[A-Za-z_$][\w$]*$/;
const own = (value: unknown, key: string) => value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);

/**
 * Exposes app state to the in-app test driver as `name`, for flows that check it with `assertState: { path, equals }`
 * (docs/test-driver.md#exposed-state). `read` runs only when a driver session asks, which only a test-driver launch can;
 * it returns JSON data. Paths are `name` then own properties or array indices separated by dots (`documents.open.length`).
 */
export function exposeTestState(name: string, read: () => unknown): Subscription {
  if (typeof name !== "string" || !NAME.test(name) || typeof read !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a state name (a JavaScript identifier) and a read function");
  if (roots.has(name)) throw new SparkError("E_ALREADY_EXISTS", `Test state ${name} is already exposed`);
  roots.set(name, read);
  requests ??= onDesktopEvent(answer, { types: ["driverState"] });
  let removed = false;
  return { remove() {
    if (removed) return;
    removed = true;
    roots.delete(name);
    if (roots.size) return;
    requests?.remove();
    requests = undefined;
  } };
}

/** The value at `path`; the driver receives it as JSON. */
function resolve(path: string): unknown {
  const [name = "", ...keys] = path.split(".");
  const read = roots.get(name);
  if (!read) throw new SparkError("E_NOT_FOUND", `No test state named ${name}; exposed: ${[...roots.keys()].join(", ") || "none"}`);
  let value: unknown;
  try { value = read(); } catch (cause) { throw new Error(`Reading test state ${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
  let at = name;
  for (const key of keys) {
    if (!own(value, key)) throw new SparkError("E_NOT_FOUND", `${at} has no ${JSON.stringify(key)}`);
    value = (value as Record<string, unknown>)[key];
    at += `.${key}`;
  }
  if (JSON.stringify(value) === undefined) throw new SparkError("E_INVALID_DATA", `${path} is not JSON data`);
  return value;
}

function answer(event: DesktopEvent) {
  const { requestId, path } = event;
  if (!Number.isSafeInteger(requestId) || typeof path !== "string") return;
  let reply: object;
  try { reply = { requestId, value: resolve(path) }; }
  catch (error) { reply = { requestId, error: { code: error instanceof SparkError ? error.code : "E_STATE", message: (error as Error).message } }; }
  callAppNative("replyDriverState", (value): value is null => value === null, reply).catch(console.error);
}
