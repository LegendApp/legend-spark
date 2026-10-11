// A Fast Refresh boundary of its own (it exports only a component): edit REVISION and the running runtime takes the
// new module without remounting the screen, and an attached DevTools session stays attached.
const REVISION = "1";
(globalThis as { ksDevToolsRevision?: string }).ksDevToolsRevision = REVISION;

export function FastRefreshMarker() { return null; }
