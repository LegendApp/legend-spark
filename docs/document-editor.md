# Shared document editor

```sh
spark create MyEditor --example document-editor
cd MyEditor
npm run web
# Or: npm run ios -- / android / macos / windows
```

From the framework checkout, `bun run document-editor /tmp/MyEditor` first packs the SDK and creates the same example. Expo Desktop beta still owns application creation and desktop prebuild. The example adds application code and platform-specific dependency exclusions to the universal template.

## Shared behavior

One `DocumentSession` owns text, file identity, the last saved contents, pending operations, and errors. React subscribes through a small adapter. No state-library dependency or framework-specific state props are required. Multiple macOS windows viewing the same document share that session in the existing JS heap.

New, Open, Save, and Save As use the same command logic across platforms. Canceling a picker does not replace the document. Failed saves leave it dirty. A successful save records exactly the text written; newer edits remain dirty. Commands cannot overlap, and edits from another window while a dialog is pending are preserved. Desktop saves check for external changes and ask the user to use Save As on conflict. This comparison is best-effort, not a filesystem transaction against other processes.

The body uses ordinary React Native multiline TextInput. `/ui` supplies the native action buttons; this example does not expand its intentionally small single-line input contract.

## Platform adapters

| Target | File operations | Application integration |
| --- | --- | --- |
| macOS | Native open/save panels, UTF-8 text read/write | Native File menu, Command-N/O/S/Shift-S, extra views of the same document, window titles, file-open events, close and quit guards |
| Windows | Native file dialogs, UTF-8 read/write with temporary-file replacement | Main editor window and native action buttons; menus, close guards, file associations, and secondary windows remain tracked Windows work |
| iOS / Android | Expo DocumentPicker imports a copy; Expo FileSystem saves an app-owned copy; Expo Sharing opens the share sheet | Shared screen; Android back navigation checks unsaved changes |
| Web | Browser file input and download | Ctrl/Command-O/S, before-unload warning |

Mobile Save commits the app-owned copy even if the user dismisses the share sheet. Web Save requests a download; browsers do not report whether the user ultimately keeps the downloaded file. Neither adapter claims to overwrite an imported file. This is a text example, not a general file-format editor or background draft-recovery system. Save before terminating a mobile app or closing the Windows window.

## Validation

`bun run test -- tests/document-editor.test.ts` covers canceled/failed saves, concurrent edits during saving and opening, close decisions, and overlapping commands. The packed example has been bundled for all five targets and exercised in Chromium for editing and download. A native macOS build mounted the editor in Hermes and passed guard registration, disk saves, external-conflict preservation, and secondary-window creation. The Windows native dependency graph includes the new UI, API, and file-dialog source projects; Windows project generation and bundling passed. Native Windows acceptance requires the machine checks in [windows-issues.md](windows-issues.md).
