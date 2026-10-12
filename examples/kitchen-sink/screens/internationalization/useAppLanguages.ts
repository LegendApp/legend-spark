import { useCallback, useEffect, useState } from "react";
import * as app from "@legendapp/spark/app";
import { confirm } from "@legendapp/spark/dialogs";
import { describeError } from "../app-lifecycle/useAppLifecycle";

export type LanguageStatus = { saved: string | null } | { error: string } | undefined;

/** The app's languages, the per-app choice and a confirmation with Spark's default labels, through @legendapp/spark. */
export function useAppLanguages() {
  const [languages, setLanguages] = useState<app.AppLanguages>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<LanguageStatus>();
  const [confirmed, setConfirmed] = useState<boolean>();
  const read = useCallback(() => app.getAppLanguages().then(setLanguages), []);
  useEffect(() => { read().catch(cause => setError(describeError(cause))); }, [read]);
  const choose = useCallback(async (language: string | null) => {
    try { await app.setAppLanguage(language); await read(); setStatus({ saved: language }); }
    catch (cause) { setStatus({ error: describeError(cause) }); }
  }, [read]);
  const relaunch = useCallback(() => app.relaunch().catch(cause => setStatus({ error: describeError(cause) })), []);
  const confirmWithDefaults = useCallback(async (message: string) => {
    try { setConfirmed(await confirm(message)); }
    catch (cause) { setStatus({ error: describeError(cause) }); }
  }, []);
  return { availability: app.getAppLanguageAvailability(), languages, error, status, choose, relaunch, confirmed, confirmWithDefaults };
}
