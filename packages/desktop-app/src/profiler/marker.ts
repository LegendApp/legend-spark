/**
 * Starts the name of every file the profiler writes, in its JavaScript and its native half (SparkProfiler.mm), so it is
 * in any build that contains the profiler. The release-safety probe (DEVT-REL-05, scripts/e2e/runner/driver-release.ts)
 * fails a release build whose JavaScript or native code holds it.
 */
export const PROFILER_MARKER = "spark-profiler";
