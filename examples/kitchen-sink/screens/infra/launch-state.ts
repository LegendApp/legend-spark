import { useEffect, useState } from "react";
import * as app from "@legendapp/spark/app";
import * as documents from "@legendapp/spark/app/documents";
import * as files from "@legendapp/spark/files";
import { settings } from "@legendapp/spark/settings";
import * as windows from "@legendapp/spark/windows";
import { useRegistrations } from "../../shell/registrations";
import { SparkError } from "@legendapp/spark/contracts";

const describeError = (error: unknown) => error instanceof SparkError ? `SparkError:${error.code} ${error.message}` : String(error);

// The state this launch found on disk, for flows that check `launchApp: { clearState: true }`
// (e2e/flows/infra/launch-state.yaml). A launch with --ks-mark-state saves a setting (Application Support)
// and a recent document (the app's defaults domain), and resizes the main window. A later launch finds the
// setting and the document, and a launch after clearState finds neither. In driver mode the window size is
// never saved, so every driven launch starts at the configured size.
export const MARK_FLAG = "--ks-mark-state";
const SETTING = "infra-launch-state";
const DOCUMENT = "infra-launch-state.txt";
const MARKED_SIZE = { width: 1040, height: 720 };

export type LaunchState = {
  /** A Spark setting (Application Support/<namespace>/settings) was found at launch. */
  setting: boolean;
  /** The marked document is in the app's recent documents (`<namespace>.recentDocuments` in its defaults domain). */
  recent: boolean;
  /** The main window came back at the marked size: an earlier launch's frame was restored. */
  frame: boolean;
  /** This launch saved the setting and the document and resized the main window. */
  marked: boolean;
  arguments: readonly string[];
};

let launch: Promise<LaunchState> | undefined;

/** Read once per process, before this launch marks anything. */
async function readLaunchState(): Promise<LaunchState> {
  const document = `${await files.getDirectory("data")}/${DOCUMENT}`;
  const [context, stored, recent, main] = await Promise.all([app.getAppContext(), settings.get(SETTING), documents.getRecentDocuments(), windows.getWindow("main")]);
  const marked = context.launchArguments.includes(MARK_FLAG);
  if (marked) {
    const now = new Date().toISOString();
    await Promise.all([settings.set(SETTING, now), files.writeText(document, now)]);
    await documents.noteRecentDocument(document);
    await windows.setWindowBounds("main", { ...main.bounds, ...MARKED_SIZE });
  }
  return {
    setting: stored !== undefined, recent: recent.some(item => item.path === document), marked,
    frame: main.bounds.width === MARKED_SIZE.width && main.bounds.height === MARKED_SIZE.height, arguments: context.launchArguments.slice(1),
  };
}

/** This launch's state, and the files opened since launch (`application:openURLs:` with file URLs). */
export function useLaunchState() {
  const [state, setState] = useState<LaunchState>();
  const [files, setFiles] = useState<readonly string[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    (launch ??= readLaunchState()).then(value => { if (active) setState(value); }, cause => { if (active) setError(describeError(cause)); });
    return () => { active = false; };
  }, []);
  useRegistrations(hold => {
    hold(documents.subscribeToOpenRequests(request => { if (request.type === "file") setFiles(list => [...list, request.path]); }));
  }, cause => setError(describeError(cause)), []);
  return { state, files, error };
}
