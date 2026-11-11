# Storage and settings

Exports: `@legendapp/spark/settings`, `/settings/observable`, `/settings/window`, `/secure-storage`, `/sqlite`.

## Pick the right store

| Data | Use |
| --- | --- |
| Small JSON preferences | `settings` (default project-scoped store) or `createSettingsStore` from `/settings` |
| Preferences bound to Legend State observables / UI | `createObservableSettings` or `createObservableFile` from `/settings/observable` |
| Tokens, passwords | `/secure-storage` (Keychain on macOS, Credential Manager on Windows) |
| Relational / large data | `openDatabase('name.sqlite')` from `/sqlite` |
| App files | `/files` with `getDirectory('data')` ([files.md](files.md)) |

All of these live in the app's own data directory (macOS: `~/Library/Application Support/<namespace>`), scoped per project.

## Rules

- Settings values are finite JSON. Use `get(key, { decode })` to validate stored data on read; reads never repair corrupt data.
- Observable files: `path` is a full absolute path including extension, and the parent directory must exist (`mkdir` first). Await `close()` before quitting, ideally in a `beforeQuit` guard. Use Legend State mutations; don't mutate `peek()` results. No remote sync: use Legend State sync for that.
- Secure storage is the Expo SecureStore subset (`getItemAsync`, `setItemAsync`, `deleteItemAsync`, `isAvailableAsync`). Missing values are `null`. Only default options; authentication/service/access-group options reject. Windows limits values to 2560 bytes. Web has no secure storage (no localStorage fallback).
- SQLite: `openDatabase` takes a simple `.sqlite` filename, not a path. Use `tx` inside `transaction`; direct calls on the database reject while a transaction is active. Integers beyond 2^53−1 reject by default; open with `{ integers: 'text' }` to read them as strings. Requires the optional peer `@op-engineering/op-sqlite@18.2.1`.

```ts
import { createObservableSettings } from '@legendapp/spark/settings/observable';
import { getDirectory, mkdir } from '@legendapp/spark/files';

const directory = `${await getDirectory('data')}/preferences`;
await mkdir(directory);
const preferences = await createObservableSettings({
  path: `${directory}/preferences.json`,
  fields: {
    theme: { defaultValue: 'system', decode: (value: unknown): string => (value === 'light' || value === 'dark' ? value : 'system') },
  },
});
preferences.value$.theme.set('dark');
await preferences.close();
```

Each field needs `defaultValue` and `decode`; defaults apply only to absent fields.

```ts
import { openDatabase } from '@legendapp/spark/sqlite';

const db = await openDatabase('notes.sqlite');
try {
  await db.run('CREATE TABLE IF NOT EXISTS notes (body TEXT)');
  await db.transaction(async tx => { await tx.run('INSERT INTO notes VALUES (?)', ['Hello']); });
  console.log(await db.getAll('SELECT body FROM notes'));
} finally {
  await db.close();
}
```

## Settings window UI

`/settings/window` builds a macOS-style preferences window: a sidebar of pages (`SettingsWindow`, or `VirtualizedSettingsWindow` for long pages) whose content is `SettingsPage` > `SettingsSection` > `SettingsRow` (`title`, optional `description`, and a `control`). Register the window with `createSettingsWindowOptions()`: it opens hidden and `SettingsWindow` shows it once its native layout is ready. `windowId` must match the registered ID and cannot change while mounted. Selection is uncontrolled (`defaultPageId`) or controlled (`selectedPageId` + `onSelectionChange`). Requires the `@legendapp/list` peer.

```tsx
import { SettingsPage, SettingsRow, SettingsSection, SettingsWindow, createSettingsWindowOptions } from '@legendapp/spark/settings/window';
import { createWindowsNavigator } from '@legendapp/spark/windows';
import { Switch } from 'react-native';

function General() {
  return (
    <SettingsPage>
      <SettingsSection title="Startup" first>
        <SettingsRow title="Open at login" control={<Switch value={false} onValueChange={() => {}} />} />
      </SettingsSection>
    </SettingsPage>
  );
}

function Settings() {
  return <SettingsWindow windowId="settings" pages={[{ id: 'general', title: 'General', render: () => <General /> }]} />;
}

export const windows = createWindowsNavigator({
  settings: { id: 'settings', component: Settings, options: createSettingsWindowOptions() },
});
```

## Platforms

`/settings`, `/secure-storage`: macOS, Windows; secure storage also iOS/Android via `expo-secure-store`. `/sqlite`: macOS, Windows (Windows runtime not yet verified). Prefer the Spark wrappers in shared code; direct `op-sqlite` imports skip Spark's per-project isolation.
