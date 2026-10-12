/**
 * Marks each React DevTools agent Spark's Select element fix has wrapped, so it is in the JavaScript of any bundle that
 * contains the fix. The release-safety probe (DEVT-REL-06, scripts/e2e/runner/driver-release.ts) fails a release build
 * whose JavaScript holds it.
 */
export const REACT_DEVTOOLS_MARKER = "spark-react-devtools";
