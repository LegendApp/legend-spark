# API cleanup implementation

Approved scope: [shared contracts and all API families](api-contracts.md), including the [window contract](api-window-contract.md). React Native is assumed; no legacy/deprecated forwarding exports are required. Expo compatibility applies to explicitly selected methods; SQLite and WebView require Spark-owned contracts.

Base: `5e17417` on `jmeistrich/fix-api-defects`. Local stack starts at `jmeistrich/api-contracts`. Remote main has unrelated divergence; no history rewrite or push is part of this work.

## Completion criteria

- [ ] Shared errors, native-response validation and lifecycle contracts used by feature APIs.
- [ ] App/documents/windows consolidated, with explicit identities, typed events and preserved desktop capabilities.
- [ ] Menus, shortcuts, context/tray/Dock share contracts.
- [ ] Files/dialogs/settings and remaining system APIs normalized; duplicate public exports removed with their callers.
- [ ] SQLite, WebView and audio expose owned contracts, with adapter/lifecycle coverage.
- [ ] UI, drag/drop and configuration/tooling contracts aligned.
- [ ] Public export inventory reconciled, TypeScript and relevant tests pass; native checks recorded with actual target coverage.

This is an implementation checklist, not a claim that the whole approved design has landed. Unit checks with mocked native boundaries do not establish native platform parity.

## Verified units

- Shared native-free contracts: 8 focused tests and full TypeScript check passed.
- SQLite: public backend objects replaced by Spark query/transaction/close types; kitchen-sink callers updated. Real in-memory SQLite tests cover parameters/blobs, commit/rollback, transaction lifetime, close ordering and unsafe values. Native OP-SQLite execution still requires target validation.
