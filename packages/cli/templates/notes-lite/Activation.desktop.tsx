import { readText } from "@legendapp/spark/files";
import { OpenFiles } from "./shared/OpenFiles";
import { notes } from "./store";
const open = async (path: string) => { await notes.load(); if (!notes.getSnapshot().ready) throw new Error("Notes storage is unavailable"); const text = await readText(path); notes.create(text); };
export function Activation({ windowId, onError }: { windowId: string; onError(message: string): void }) { return <OpenFiles windowId={windowId} onFile={open} onError={onError} />; }
