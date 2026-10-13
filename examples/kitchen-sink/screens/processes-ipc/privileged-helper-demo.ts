import { useCallback, useRef, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import {
  PrivilegedHelperError, getPrivilegedHelperAvailability, getPrivilegedHelperStatus, openPrivilegedHelperSettings, registerPrivilegedHelper,
  requestAdminAuthorization, sendPrivilegedHelperMessage, unregisterPrivilegedHelper, type AdminAuthorization,
} from "@legendapp/spark/privileged-helper";

/** The Kitchen Sink's helper (helpers/privileged-helper). It is embedded only in a build that opts in, so this one reports notFound. */
export const HELPER = "privileged-helper";
const PROMPT = "The Kitchen Sink is checking that its privileged helper verifies administrator rights.";
/** Results show codes and reasons only, so flows can assert them in any locale. */
const describeFailure = (cause: unknown) =>
  cause instanceof PrivilegedHelperError ? `PrivilegedHelperError:${cause.code}:${cause.reason}` : cause instanceof SparkError ? `SparkError:${cause.code}` : String(cause);
/** JSON with object keys sorted, so a reply reads the same however native ordered it. */
const sortedJSON = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const readAvailability = () => JSON.stringify(getPrivilegedHelperAvailability());
export type Section = "status" | "registration" | "authorization" | "message";

/**
 * The privileged helper, admin prompt and XPC through @legendapp/spark/privileged-helper. Nothing is registered, prompted
 * or sent until a button is pressed. In a test-driver run every call goes to the simulated state
 * (docs/privileged-helper.md#testing): nothing is registered with launchd, no prompt is shown and nothing runs as root.
 */
export function usePrivilegedHelperDemo() {
  const [availability, setAvailability] = useState(readAvailability);
  const [results, setResults] = useState<Partial<Record<Section, string>>>({});
  const [held, setHeld] = useState(false);
  const authorization = useRef<AdminAuthorization | undefined>(undefined);

  const show = useCallback((section: Section, result: string) => setResults(current => ({ ...current, [section]: result })), []);
  const run = useCallback(async (section: Section, action: () => Promise<string>) => {
    let result: string;
    try { result = await action(); } catch (cause) { result = describeFailure(cause); }
    show(section, result);
  }, [show]);

  const refresh = useCallback(() => {
    setAvailability(readAvailability());
    return run("status", () => getPrivilegedHelperStatus(HELPER));
  }, [run]);
  const register = useCallback(() => run("registration", async () => {
    const status = await registerPrivilegedHelper(HELPER);
    show("status", status);
    return `registered: ${status}`;
  }), [run, show]);
  const unregister = useCallback(() => run("registration", async () => {
    await unregisterPrivilegedHelper(HELPER);
    show("status", await getPrivilegedHelperStatus(HELPER));
    return "unregistered";
  }), [run, show]);
  const openSettings = useCallback(() => run("registration", async () => { await openPrivilegedHelperSettings(); return "settings opened"; }), [run]);

  const authorize = useCallback(() => run("authorization", async () => {
    const result = await requestAdminAuthorization({ prompt: PROMPT });
    if (result.type === "cancel") return "cancel";
    await authorization.current?.close();
    authorization.current = result.authorization;
    setHeld(true);
    return "authorized";
  }), [run]);
  const release = useCallback(() => run("authorization", async () => {
    const current = authorization.current;
    authorization.current = undefined;
    setHeld(false);
    await current?.close();
    return "released";
  }), [run]);

  const send = useCallback((withAuthorization: boolean) => run("message", async () => {
    const reply = await sendPrivilegedHelperMessage(HELPER, { command: "whoami" }, withAuthorization && authorization.current ? { authorization: authorization.current } : {});
    return sortedJSON(reply);
  }), [run]);

  return { availability, results, held, refresh, register, unregister, openSettings, authorize, release, send };
}
