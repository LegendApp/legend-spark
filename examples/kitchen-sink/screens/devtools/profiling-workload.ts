// Busy JavaScript for the profiler: Profiling › Run JavaScript workload calls it in the shared runtime, and the worker
// runtime's workload (devtools-tasks.ts) in ks-devtools. Its samples name fibonacci in this file once source-mapped.
export function profilingWorkload(milliseconds: number): number {
  const end = Date.now() + milliseconds;
  let total = 0;
  while (Date.now() < end) total += fibonacci(18);
  return total;
}

function fibonacci(n: number): number {
  return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2);
}
