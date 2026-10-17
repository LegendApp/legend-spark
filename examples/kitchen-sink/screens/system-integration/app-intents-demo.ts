import { useCallback, useRef, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import {
  addAppEntityQueryHandler, addAppIntentHandler, donateAppIntent, getAppIntents, getAppIntentsAvailability,
  type AppEntityItem, type AppEntityQueryHandler, type AppIntentHandler, type AsyncRegistration,
} from "@legendapp/spark/app-intents";
import { useRegistrations } from "../../shell/registrations";
import { describeError } from "../app-lifecycle/useAppLifecycle";
import { NOTE_ENTITY, NOTE_INTENT, RECIPE_INTENT, TIMER_INTENT } from "./app-intents-config";

/** Results show only the error code, so flows can assert them in any locale. */
const code = (cause: unknown) => cause instanceof SparkError ? `SparkError:${cause.code}` : String(cause);
/** Newest first; the screen keeps the last six. */
const KEEP = 6;

/** The KsRecipe enum's cases (KS_APP_ENUMS), by value. Results are API data, so they are not translated. */
const RECIPES: Record<string, string> = { pancakes: "Pancakes", gazpacho: "Gazpacho", soup: "Soup" };
/** The KsNote entities the query handler lists and finds. */
const NOTES: readonly AppEntityItem[] = [
  { id: "groceries", title: "Groceries", subtitle: "Eggs, flour, milk" },
  { id: "packing", title: "Packing list" },
  { id: "recipes", title: "Recipes to try", subtitle: "Gazpacho, soup" },
];

/**
 * Show Recipe answers with text; Start Timer returns nothing, and fails over 60 minutes so the error reaches the caller;
 * Open Note answers with the note's title, and fails for an id the query handler does not know.
 */
function kitchenSinkHandlers(log: (text: string) => void): Record<string, AppIntentHandler> {
  return {
    [RECIPE_INTENT]: ({ parameters: { recipe, servings } }) => {
      const answer = `${RECIPES[String(recipe)]} for ${String(servings)}`;
      log(`${RECIPE_INTENT}: ${answer}`);
      return answer;
    },
    [TIMER_INTENT]: ({ parameters: { minutes } }) => {
      if (typeof minutes !== "number" || minutes > 60) { log(`${TIMER_INTENT}: refused ${String(minutes)}`); throw new SparkError("E_INVALID_ARGUMENT", "A timer runs at most 60 minutes"); }
      log(`${TIMER_INTENT}: ${minutes} min`);
    },
    [NOTE_INTENT]: ({ parameters: { note } }) => {
      const found = NOTES.find(item => item.id === note);
      if (!found) { log(`${NOTE_INTENT}: no note ${String(note)}`); throw new SparkError("E_NOT_FOUND", `No note ${String(note)}`); }
      log(`${NOTE_INTENT}: ${found.title}`);
      return `Opened ${found.title}`;
    },
  };
}

/** The notes a query asks for: by id, all of them as suggestions, or those whose title contains the search text. */
function notesQuery(log: (text: string) => void): AppEntityQueryHandler {
  return query => {
    const notes = query.kind === "identifiers" ? NOTES.filter(note => query.identifiers.includes(note.id))
      : query.kind === "search" ? NOTES.filter(note => note.title.toLowerCase().includes(query.text.toLowerCase())) : NOTES;
    log(`${NOTE_ENTITY} ${query.kind === "search" ? `search "${query.text}"` : query.kind}: ${notes.map(note => note.id).join(", ") || "none"}`);
    return [...notes];
  };
}

/**
 * Handlers for the three Kitchen Sink intents, the query handler for its notes, a donation, and the intents the app declares, through
 * @legendapp/spark/app-intents. Opening the screen only registers the handlers; nothing is donated until a button is
 * pressed. In a test-driver run the intents are simulated (docs/app-intents.md#testing): nothing reaches Shortcuts,
 * Spotlight or Siri.
 */
export function useAppIntentsDemo() {
  const [declared, setDeclared] = useState<string>();
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<readonly { key: number; text: string }[]>([]);
  const [donation, setDonation] = useState<string>();
  const [error, setError] = useState<string>();
  const received = useRef(0);
  // Registrations run one at a time, so Listen again releases each id before taking it again (one handler per id).
  const queue = useRef<Promise<void>>(Promise.resolve());
  const registrations = useRef<AsyncRegistration[]>([]);
  const mounted = useRef(false);
  const report = useCallback((cause: unknown) => setError(describeError(cause)), []);
  const log = useCallback((text: string) => setEvents(list => [{ key: ++received.current, text }, ...list].slice(0, KEEP)), []);

  const enqueue = useCallback((step: () => Promise<void>) => { queue.current = queue.current.then(step).catch(report); }, [report]);
  const release = useCallback(async () => { await Promise.all(registrations.current.splice(0).map(registration => registration.remove())); }, []);
  const listen = useCallback(() => enqueue(async () => {
    await release();
    if (!mounted.current) return;
    setStatuses({});
    setDeclared(await getAppIntents().then(list => list.map(intent => intent.id).join(", ") || "none", code));
    const handlers: Record<string, () => Promise<AsyncRegistration>> = {
      ...Object.fromEntries(Object.entries(kitchenSinkHandlers(log)).map(([id, handler]) => [id, () => addAppIntentHandler(id, handler, { onError: report })])),
      [NOTE_ENTITY]: () => addAppEntityQueryHandler(NOTE_ENTITY, notesQuery(log), { onError: report }),
    };
    for (const [id, add] of Object.entries(handlers)) {
      try {
        registrations.current.push(await add());
        if (!mounted.current) { await release(); return; }
        setStatuses(current => ({ ...current, [id]: "listening" }));
      } catch (cause) { setStatuses(current => ({ ...current, [id]: code(cause) })); }
    }
  }), [enqueue, release, log, report]);

  useRegistrations(hold => {
    mounted.current = true;
    listen();
    hold({ remove: () => { mounted.current = false; enqueue(release); } });
  }, report, [listen, enqueue, release, report]);

  const donate = useCallback(async () => {
    try { await donateAppIntent(RECIPE_INTENT, { recipe: "pancakes", servings: 2 }); setDonation("donated"); }
    catch (cause) { setDonation(code(cause)); }
  }, []);

  return { availability: getAppIntentsAvailability(), declared, statuses, events, donation, error, listen, donate };
}
