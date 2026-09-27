import { openFileDialog } from "@legendapp/spark/dialogs";
import type { Track } from "./model";
export async function importTracks(): Promise<Track[]> {
  const paths = await openFileDialog({ filters: [{ extensions: ["mp3", "m4a", "wav", "aac", "flac", "ogg"] }], multiple: true });
  return (paths.canceled ? [] : paths.paths).map(uri => ({ id: uri, uri, name: uri.split(/[\\/]/).pop()! }));
}
export const resolveTrack = async (track: Track) => ({ uri: track.uri, release() {} });
