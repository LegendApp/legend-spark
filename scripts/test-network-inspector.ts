// bun scripts/test-network-inspector.ts — the network inspector against a real development session, headless
// (docs/devtools.md#network-inspector). Build first: cd examples/kitchen-sink && bun run rebuild:macos.
// Starts the loopback fixtures (127.0.0.1 only, scripts/testing/network-fixtures.ts) and a development session
// (scripts/testing/dev-session.ts), attaches to the shared runtime over CDP as React Native DevTools does, runs the
// Kitchen Sink's network scenarios and checks both what the app received (unchanged by the inspector) and the Network
// events DevTools received through the development server.
import assert from "node:assert/strict";
import { BINARY, LARGE, STREAM, TEXT, serveNetworkFixtures } from "./testing/network-fixtures.ts";
import { startDevSession, type Cdp, type Message } from "./testing/dev-session.ts";

const fixtures = await serveNetworkFixtures();
const dev = await startDevSession({ prefix: "ks-network-" });
const pass = (message: string) => console.log(`PASS ${message}`);
const network = (events: Message[]) => events.filter(message => message.method?.startsWith("Network."));
const hex = (bytes: Buffer) => bytes.toString("hex");
const base = fixtures.url;
let cdp: Cdp | undefined;
/** Where the current scenario's events start in the CDP client's events. */
let mark = 0;

/** Runs a Kitchen Sink scenario (screens/devtools/network-demo.ts) in the app and returns what it received. */
async function run(scenario: string): Promise<any> {
  mark = cdp!.events.length;
  const { value, error } = await cdp!.settle(`ksNetwork.run(${JSON.stringify(scenario)}, ${JSON.stringify(base)})`);
  assert.equal(error, undefined, `${scenario}: ${error}`);
  return value;
}
/** The current scenario's Network events for its request to `path`, once its `done` event has arrived. */
async function request(path: string, done = "Network.loadingFinished") {
  const since = () => cdp!.events.slice(mark);
  const sent = await dev.until(async () => since().find(message => message.method === "Network.requestWillBeSent" && message.params.request.url === `${base}${path}`)?.params, `requestWillBeSent for ${path}`, 20000);
  await dev.until(async () => since().some(message => message.method === done && message.params.requestId === sent.requestId), `${done} for ${path}`, 20000);
  return { sent, events: network(since()).filter(message => message.params.requestId === sent.requestId) };
}
const body = (requestId: string) => cdp!.send("Network.getResponseBody", { requestId }) as Promise<{ body: string; base64Encoded: boolean }>;
/** A header by name in any case: fetch's Headers lowercases names, XMLHttpRequest keeps them as set. */
const header = (headers: Record<string, string>, name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const decoded = (result: { body: string; base64Encoded: boolean }) => Buffer.from(result.body, result.base64Encoded ? "base64" : "utf8");

try {
  const { name } = await dev.launch();
  const shared = await dev.target(`${name} (shared runtime)`);

  // 1. Without an attached DevTools session (Runtime and Log enabled), nothing is recorded or reported.
  cdp = await dev.connect(shared);
  await cdp.send("Runtime.enable");
  assert.deepEqual(await cdp.evaluate("ksNetwork.availability()"), { available: true });
  assert.deepEqual(await run("fetch"), { status: 200, text: TEXT });
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.deepEqual(network(cdp.events), []);
  assert.equal(await cdp.evaluate("ksNetwork.log().length"), 0);
  pass("idle: with no DevTools session and no listener, a fetch is neither recorded nor reported");

  // 2. With a session (DevTools enables Runtime and Log), requests reach DevTools through the development server.
  await cdp.send("Log.enable");
  await cdp.send("Network.enable").catch(() => undefined); // React Native 0.81's own Network domain is off; Expo CLI relays the events.
  assert.deepEqual(await run("fetch"), { status: 200, text: TEXT });
  const fetched = await request("text");
  assert.equal(fetched.sent.type, "Fetch");
  assert.equal(header(fetched.sent.request.headers, "Authorization"), "[redacted]");
  assert.equal(header(fetched.sent.request.headers, "Cookie"), "[redacted]");
  assert.ok(fetched.sent.initiator.stack.callFrames.length > 0, "the initiator has a stack");
  const response = fetched.events.find(message => message.method === "Network.responseReceived")!.params.response;
  assert.equal(response.status, 200);
  assert.equal(response.mimeType, "text/plain");
  assert.equal(header(response.headers, "Set-Cookie"), "[redacted]");
  assert.equal(fixtures.requests.at(-1)!.headers.authorization, "Bearer ks-secret", "the server received the real header");
  assert.equal(decoded(await body(fetched.sent.requestId)).toString("utf8"), TEXT);
  assert.ok(!JSON.stringify(network(cdp.events)).includes("ks-secret") && !JSON.stringify(network(cdp.events)).includes("fixture-secret"), "no secret reached DevTools");
  pass(`fetch: requestWillBeSent (Fetch, initiator ${fetched.sent.initiator.stack.callFrames[0].functionName || "anonymous"}), responseReceived 200 text/plain, loadingFinished; Authorization, Cookie and Set-Cookie redacted; Network.getResponseBody returns the text`);

  assert.deepEqual(await run("xhr"), { status: 200, text: TEXT });
  const { sent: xhrSent } = await request("text");
  assert.equal(xhrSent.type, "XHR");
  assert.equal(header(xhrSent.request.headers, "Authorization"), "[redacted]");
  const xhrBody = await body(xhrSent.requestId);
  assert.deepEqual([xhrBody.base64Encoded, xhrBody.body], [false, TEXT]);
  pass("XMLHttpRequest: type XHR, redacted Authorization, text body");

  assert.deepEqual(await run("binary"), { bytes: hex(BINARY) });
  const binary = await request("binary");
  assert.equal(hex(decoded(await body(binary.sent.requestId))), hex(BINARY));
  const upload = await run("upload").then(async value => ({ value, request: await request("echo") }));
  assert.deepEqual(upload.value, { bytes: hex(BINARY) });
  assert.equal(hex(fixtures.requests.at(-1)!.body), hex(BINARY), "the server received the exact bytes");
  assert.equal(hex(decoded(await body(upload.request.sent.requestId))), hex(BINARY));
  pass("binary: 256 bytes down and up arrive intact in the app and at the server, and DevTools gets the same bytes (base64)");

  const redirected = await run("redirect");
  assert.deepEqual(redirected, { status: 200, url: `${base}text`, text: TEXT });
  const redirect = await request("redirect");
  assert.equal(redirect.events.find(message => message.method === "Network.responseReceived")!.params.response.url, `${base}text`);
  pass("redirect: the app follows it as before; DevTools shows the answering URL");

  const streamed = await run("stream");
  assert.equal(streamed.text, STREAM.join(""));
  assert.ok(streamed.progress >= 2, `incremental progress events still arrive (${streamed.progress})`);
  const stream = await request("stream");
  assert.ok(stream.events.filter(message => message.method === "Network.dataReceived").length >= 2, "DevTools gets each part");
  assert.equal(decoded(await body(stream.sent.requestId)).toString("utf8"), STREAM.join(""));
  pass(`streaming: ${streamed.progress} progress events in the app, ${stream.events.filter(message => message.method === "Network.dataReceived").length} dataReceived in DevTools, the whole text`);

  assert.deepEqual(await run("abort"), { aborted: true, name: "AbortError" });
  const aborted = await request("hang", "Network.loadingFailed");
  assert.equal(aborted.events.find(message => message.method === "Network.loadingFailed")!.params.canceled, true);
  await dev.until(async () => fixtures.aborted() > 0, "the server sees the connection closed", 10000);
  pass("abort: the fetch rejects with AbortError, the server sees the connection closed, DevTools gets loadingFailed (canceled)");

  assert.deepEqual(await run("large"), { length: LARGE.length });
  const large = await request("large");
  assert.equal(decoded(await body(large.sent.requestId)).toString("utf8"), LARGE.slice(0, 65536));
  pass(`size cap: the app receives all ${LARGE.length} characters; DevTools keeps the first 65536`);

  assert.deepEqual(await run("websocket"), { text: "hello", bytes: "000102ff", code: 1000 });
  const created = await cdp.event("Network.webSocketCreated", params => params.url === `${base.replace("http", "ws")}ws`);
  await cdp.event("Network.webSocketClosed", params => params.requestId === created.requestId);
  const frames = network(cdp.events).filter(message => message.params.requestId === created.requestId && /Frame(Sent|Received)$/.test(message.method!))
    .map(message => [message.method!.endsWith("Sent") ? "sent" : "received", message.params.response.opcode, message.params.response.payloadData]);
  assert.deepEqual(frames, [["sent", 1, "hello"], ["sent", 2, "AAEC/w=="], ["received", 1, "hello"], ["received", 2, "AAEC/w=="]]);
  assert.ok(network(cdp.events).some(message => message.method === "Network.webSocketHandshakeResponseReceived" && message.params.requestId === created.requestId));
  pass("WebSocket: the echo returns the text and the binary frame intact; DevTools gets the handshake, text and binary frames, and the close");

  // 3. getNetworkLog holds the same entries while DevTools observes, redacted and capped.
  const logged = JSON.parse(await cdp.evaluate("JSON.stringify(ksNetwork.log())")) as any[];
  const largeEntry = logged.filter(item => item.url === `${base}large`).at(-1);
  assert.deepEqual([largeEntry.source, largeEntry.state, largeEntry.responseBody.truncated, largeEntry.responseBody.size], ["fetch", "finished", true, LARGE.length]);
  assert.equal(header(logged.find(item => item.url === `${base}text`).requestHeaders, "Authorization"), "[redacted]");
  assert.deepEqual(logged.find(item => item.source === "websocket").frames.map((frame: any) => [frame.direction, frame.opcode, frame.data]), frames);
  pass(`log: getNetworkLog returns ${logged.length} entries with redacted headers, capped bodies and WebSocket frames`);

  // 4. Detached, nothing more is reported.
  await cdp.send("Log.disable");
  const count = network(cdp.events).length;
  assert.deepEqual(await run("fetch"), { status: 200, text: TEXT });
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(network(cdp.events).length, count);
  pass("detached: after the session ends a fetch is no longer reported");
} catch (error) {
  console.error(`Network events: ${JSON.stringify(network(cdp?.events ?? []).map(message => message.method)).slice(0, 4000)}`);
  console.error(`Network log: ${await cdp?.evaluate("JSON.stringify(ksNetwork.log().map(entry => [entry.source, entry.url, entry.state, entry.status, entry.error]))").catch(String)}`);
  dev.printLogs();
  throw error;
} finally {
  await dev.close();
  await fixtures.stop();
}
