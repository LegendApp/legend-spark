import { useCallback, useRef, useState, type RefObject } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import * as files from "@legendapp/spark/files";
import * as links from "@legendapp/spark/links";
import {
  addServiceListener, addSpotlightListener, deleteSpotlightItems, getSharingAvailability, indexSpotlightItems, share,
  type AsyncRegistration, type ShareItem, type SpotlightItem,
} from "@legendapp/spark/sharing";
import { useRegistrations } from "../../shell/registrations";
import { describeError } from "../app-lifecycle/useAppLifecycle";

/** The service this screen listens for. The Kitchen Sink declares no NSServices, so only a driver run can declare it. */
export const SERVICE = "Kitchen Sink: Show Text";
/** The scheme the Kitchen Sink declares (CFBundleURLTypes). */
export const SCHEME = "spark-ks";
export const RECIPES: readonly SpotlightItem[] = [
  { id: "ks-recipe-1", title: "Pancakes", domain: "ks-recipes", keywords: ["breakfast"] },
  { id: "ks-recipe-2", title: "Gazpacho", domain: "ks-recipes", description: "Cold tomato soup" },
  { id: "ks-recipe-3", title: "Shortbread", domain: "ks-recipes", keywords: ["baking", "dessert"] },
];
export type ShareKind = "text" | "link" | "file";
export const SHARE_KINDS: readonly ShareKind[] = ["text", "link", "file"];
/** Results show only the error code, so flows can assert them in any locale. */
const code = (cause: unknown) => cause instanceof SparkError ? `SparkError:${cause.code}` : String(cause);
/** Newest first; the screen keeps the last six. */
const KEEP = 6;

async function shareItems(kind: ShareKind): Promise<ShareItem[]> {
  if (kind === "text") return [{ type: "text", text: "Pancakes: flour, milk, eggs." }];
  if (kind === "link") return [{ type: "url", url: "https://legendapp.com/spark" }];
  const path = `${await files.getDirectory("temp")}/ks-sharing-recipe.txt`;
  await files.writeText(path, "Pancakes: flour, milk, eggs.\n");
  return [{ type: "file", path }];
}

/**
 * The share picker, a Services listener, Spotlight items and the default URL handler through @legendapp/spark/sharing
 * and /links. Opening the screen only registers listeners and reads whether the app is the spark-ks handler; nothing is
 * shared, indexed or made default until a button is pressed. In a test-driver run every call goes to simulated state
 * (docs/sharing.md#testing): no picker appears and the Spotlight index, pbs and LaunchServices are never touched.
 */
export function useSharingDemo(anchor: RefObject<object | null>) {
  const [results, setResults] = useState<Record<string, string>>({});
  const [serviceStatus, setServiceStatus] = useState<string>();
  const [events, setEvents] = useState<readonly { key: number; text: string }[]>([]);
  const [defaultHandler, setDefaultHandler] = useState<string>();
  const [error, setError] = useState<string>();
  const received = useRef(0);
  // Service registrations run one at a time, so a re-listen releases the name before taking it again (one listener per name).
  const queue = useRef<Promise<void>>(Promise.resolve());
  const service = useRef<AsyncRegistration | undefined>(undefined);
  const mounted = useRef(false);
  const report = useCallback((cause: unknown) => setError(describeError(cause)), []);
  const result = useCallback((key: string, text: string) => setResults(current => ({ ...current, [key]: text })), []);
  const log = useCallback((text: string) => setEvents(list => [{ key: ++received.current, text }, ...list].slice(0, KEEP)), []);
  const readDefault = useCallback(() => links.isDefaultURLHandler(SCHEME).then(value => setDefaultHandler(value ? "default" : "not default"), cause => setDefaultHandler(code(cause))), []);

  const enqueue = useCallback((step: () => Promise<void>) => { queue.current = queue.current.then(step).catch(report); }, [report]);
  const release = useCallback(async () => { const registration = service.current; service.current = undefined; await registration?.remove(); }, []);
  const listen = useCallback(() => enqueue(async () => {
    await release();
    if (!mounted.current) return;
    setServiceStatus(undefined);
    try {
      const registration = await addServiceListener(SERVICE, ({ text, files: paths }) => log(`service: ${text ?? paths.join(", ")}`), { onError: report });
      service.current = registration;
      if (!mounted.current) { await release(); return; }
      setServiceStatus("listening");
    } catch (cause) { setServiceStatus(code(cause)); }
  }), [enqueue, release, log, report]);

  useRegistrations(hold => {
    mounted.current = true;
    listen();
    hold({ remove: () => { mounted.current = false; enqueue(release); } });
    hold(links.addEventListener("url", ({ url }) => { if (/^https:/i.test(url)) log(`link: ${url}`); }));
    void readDefault();
    hold(addSpotlightListener(({ id }) => log(`spotlight: ${id}`), { onError: report }));
  }, report, [listen, enqueue, release, log, report, readDefault]);

  const run = useCallback(async (key: string, action: () => Promise<string>) => {
    try { result(key, await action()); } catch (cause) { result(key, code(cause)); }
  }, [result]);
  const shareKind = useCallback((kind: ShareKind) => run("share", async () => {
    const { service: chosen } = await share(await shareItems(kind), { anchor: anchor.current ?? undefined });
    return chosen ?? "dismissed";
  }), [run, anchor]);
  const index = useCallback(() => run("spotlight", async () => { await indexSpotlightItems(RECIPES); return `indexed ${RECIPES.length}`; }), [run]);
  const remove = useCallback(() => run("spotlight", async () => { await deleteSpotlightItems({ domains: ["ks-recipes"] }); return "deleted"; }), [run]);
  const makeDefault = useCallback(() => run("default", async () => { await links.setDefaultURLHandler(SCHEME); await readDefault(); return "set"; }), [run, readDefault]);

  const availability = {
    share: getSharingAvailability("share"), services: getSharingAvailability("services"),
    spotlight: getSharingAvailability("spotlight"), defaultURLHandler: links.getDefaultURLHandlerAvailability(),
  };
  return { availability, results, serviceStatus, events, defaultHandler, error, shareKind, listen, index, remove, makeDefault };
}
