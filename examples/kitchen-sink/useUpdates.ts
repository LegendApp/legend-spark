import { useCallback, useEffect, useState } from "react";
import * as updates from "@legendapp/spark/updates";

// Starts a configured updater once, observes its events, and refreshes status after each command.
export function useUpdates(reportEvent: (value: unknown) => void) {
  const [availability, setAvailability] = useState<updates.UpdateAvailability>();
  const [status, setStatus] = useState<updates.UpdateStatus>();
  const refresh = useCallback(async () => { setStatus(await updates.getUpdateStatus()); }, []);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const value = await updates.getUpdateAvailability();
      if (value.available) await updates.startUpdates();
      const current = await updates.getUpdateStatus();
      if (!disposed) { setAvailability(value); setStatus(current); }
    })().catch(reportEvent);
    let events: updates.Subscription | undefined;
    try { events = updates.onUpdateEvent(event => { reportEvent(event.state === "error" ? new Error(event.message) : event); if (!disposed) void refresh().catch(reportEvent); }); }
    catch (error) { reportEvent(error); }
    return () => { disposed = true; events?.remove(); };
  }, [refresh, reportEvent]);
  // Commands report the typed SparkError code so unsupported paths are visible.
  const run = useCallback(async (command: () => Promise<void>) => {
    try { await command(); }
    catch (error) { throw new Error(error instanceof Error && "code" in error ? `${String(error.code)}: ${error.message}` : String(error)); }
    finally { await refresh().catch(reportEvent); }
  }, [refresh, reportEvent]);
  return { availability, status, run };
}
