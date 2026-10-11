# Small application examples

These are standalone applications created from the same universal Expo Desktop
beta template as Settings. Source ships inside the CLI; there are no dependencies
on `legend-apps`, `legend-notes`, or another checkout.

```sh
npm create @legendapp/spark@next MyNotes -- --example notes-lite
npm create @legendapp/spark@next MyMusic -- --example music-lite
npm create @legendapp/spark@next MyDiff -- --example diff-lite
```

Inside each project, run `npm run web`, `npm run ios`, `npm run android`,
`npm run macos`, or `npm run windows`. Mobile native development clients need a
first build. Desktop selects a compatible Spark Runner or requests a custom build
when a native dependency is missing. Rebuild an older Spark Runner for the new audio,
AsyncStorage, or Windows host implementations; JavaScript reload cannot add them.

## Notes Lite

Create and search plain-text notes, edit with ordinary React Native text inputs,
import/export text, and recover deleted notes. Large windows show a sidebar;
phones show a list and a detail screen. Desktop secondary windows share the same
notebook model and can show the same note. Autosave writes after 250 ms of idle
editing. Close/background handlers attempt to flush pending changes. A failed
save remains visible and can be retried; unreadable storage disables editing.

Notes are app-owned records, separate from imported files. Import copies text;
export writes a separate file. Edits do not overwrite the imported source.
Deleted notes remain recoverable until the application adds an explicit permanent
delete policy. This small example does not implement cloud sync, rich Markdown,
folder mirroring, or audio transcription.

## Music Lite

Import audio, choose a track, pause/resume, seek in ten-second increments, and
advance through the queue. Queue and position persist; restoring a session does
not automatically start playback. Mobile imports are copied into app documents;
web imports are retained as blobs in IndexedDB. Desktop imports retain original
file paths, so moving/removing the source produces an error on subsequent use.
Audio-format support comes from the platform decoder.

`@legendapp/spark-audio` provides the small player contract. It uses Expo Audio 1.1.1
on iOS/Android, AVPlayer on macOS, MediaPlayer on Windows, and HTML audio on web.
Mobile enables background playback through Expo's config plugin. Platform media
controls are connected to the active player. The example owns its queue and
persistence; the module owns player resources. This is not the full Legend Music
library scanner, metadata index, or visualizer.

## Diff Lite

Open two text files and view a line comparison with explicit addition/removal
markers and line numbers. Files are read-only. Each input is limited to 200,000
characters and comparison has a time limit to keep this small example usable.
The comparison algorithm comes from `diff`, imported directly.

On macOS, the Git action selects a repository and invokes `/usr/bin/git` through
the public process module, with an argument array, timeout, and external diff/text
conversion disabled. Other platforms retain ordinary file comparison. There is no
Git authentication, conflict resolution, or embedded shell.

## Persistence and replacement boundaries

`shared/records.ts` is an example-owned snapshot store, backed by upstream
AsyncStorage 2.2.0. Keys include the generated stable project identity, including
inside prebuilt. Windows supplies AsyncStorage's database-path override for our
unpackaged host. Two alternating checksummed records retain the previous completed
snapshot if a write is damaged. This checksum detects corruption, not tampering.

The store has one writer per key in a JS runtime. Desktop windows share that writer.
It is not a multi-process database or a sync engine. It does not encrypt data;
credentials belong in SecureStore. Browser storage remains subject to origin,
quota, and eviction rules. A write still in flight when the OS kills an app can
lose the newest changes; recovery uses the most recent valid completed snapshot.

Models validate a versioned data shape on load. Implement migrations in the decode
function before changing its version, retaining the previous snapshot until the
new write succeeds. Move a larger app to a database through the same persistence
boundary when it needs transactions, indexes, or concurrent writers.

See [extension development](extensions.md), [audio](audio.md), and
[known Windows issues](windows-issues.md). Native Windows compilation and interaction
checks must run on Windows; bundle success alone does not establish native support.
The [acceptance record](example-validation.md) distinguishes passing checks from
remaining device work, including the development machine's audio-output limitation.

## Notes Lite desktop behavior

Notes Lite is also the integration example for window/session behavior. Its File
menu, focused-window shortcuts, and buttons share command handlers. The modifier
is Command on macOS and Control on Windows:

| Action | Shortcut |
| --- | --- |
| New note | Modifier+N |
| Save / retry | Modifier+S |
| Import text | Modifier+O |
| Search (focuses the main window) | Modifier+F |
| Delete current note (recoverable) | Modifier+Shift+Backspace |
| Open current note in its dedicated window | Modifier+Shift+N |
| Settings | Modifier+, |

Opening a note again focuses its existing dedicated window. Settings also has one
desktop window; mobile and web show it within the app. System appearance is the
default, with Light and Dark overrides saved in the notebook and shared by all
windows. Existing notebooks without these fields keep their notes and use System.

A normal quit saves the main, Settings, and note window frames; the next launch
reopens surviving notes and fits frames onto the currently connected displays.
Manually closed windows are removed from the session. Deleted notes are not reopened.
This restores positions and sizes, not fullscreen/minimized state. The shared JS
runtime is the synchronization boundary; separate application processes and browser
tabs are not a cross-process editing solution.

Failed saves remain visible and prevent guarded desktop close/quit. Retry save
retries persistence; unrelated command failures have a separate dismissible message.
OS force termination cannot be vetoed and may lose changes after the last completed
snapshot. See [Notes acceptance](notes-lite-acceptance.md) for repeatable checks.
