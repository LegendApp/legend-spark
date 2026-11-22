import { afterAll, expect, test } from "vitest";
import { createBundleServer } from "../scripts/e2e/kitchen-sink.ts";

const server = createBundleServer(Buffer.from("bundle"), new Map());
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

test("reports the Metro packager status", async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  const response = await fetch(`http://127.0.0.1:${address.port}/status`);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("packager-status:running");
});
