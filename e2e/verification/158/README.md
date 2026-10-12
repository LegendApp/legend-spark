# #158 Localized framework-provided native strings: verification

Captures came from `bun run ks:capture internationalization/native-strings --wait-for internationalization-native-strings-current`
against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`). I opened and checked every one.

| Image | Flags | What it shows |
|---|---|---|
| native-strings-light.png | `--appearance light` | The app lists en, ar, fr; this launch is `en`; no per-app language; Spark's strings exist in ar, en, fr. |
| native-strings-dark.png | `--appearance dark` | The same in dark. |
| native-strings-light-ar.png | `--appearance light --locale ar` | Current language `ar`, right to left. The breadcrumb's "Native strings" stays English: catalog titles are English-only. |
| native-strings-light-fr.png | `--appearance light --locale fr` | Current language `fr`. The Kitchen Sink has no French catalog, so its own text is English; its menus are French (menus.txt). |

`menus.txt` is the menu bar the in-app driver read (`menus` command, two levels) after launching with
`-AppleLanguages (en)`, `(ar)` and `(fr)`. In Arabic and French every title is translated: Spark's
(the template menu, About, Hide, Quit, Help with the app name) and AppKit's own (Settings…, Close All,
AutoFill, Start Dictation, Emoji & Symbols). The Kitchen Sink's Document menu follows its own catalog
(English and Arabic only).
