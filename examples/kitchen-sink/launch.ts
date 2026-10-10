// Launch arguments that open a native-test report instead of the interactive Kitchen Sink.
export const REPORT_FLAGS = [
  "--spark-auth-report",
  "--spark-audio-report",
  "--spark-files-report",
  "--spark-foundation-report",
  "--spark-ui-report",
  "--spark-api-report",
  "--spark-expansion-report",
  "--spark-test-report",
] as const;
export type ReportFlag = (typeof REPORT_FLAGS)[number];

export function argument(args: readonly string[], name: string) { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; }

/** The first report flag with a value, in REPORT_FLAGS order; undefined for an interactive launch. */
export function reportLaunch(args: readonly string[]): { flag: ReportFlag; report: string } | undefined {
  for (const flag of REPORT_FLAGS) {
    const report = argument(args, flag);
    if (report) return { flag, report };
  }
}
