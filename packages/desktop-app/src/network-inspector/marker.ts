/**
 * Starts every network inspector entry id, so it is in the JavaScript of any bundle that contains the inspector. The
 * release-safety probe (DEVT-REL-04, scripts/e2e/runner/driver-release.ts) fails a release build whose JavaScript holds it.
 */
export const NETWORK_INSPECTOR_MARKER = "spark-network-inspector";
