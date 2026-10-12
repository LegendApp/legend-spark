import { NativeEventEmitter } from "react-native";
import NativeFileReaderModule from "react-native/Libraries/Blob/NativeFileReaderModule";
import RCTNetworking from "react-native/Libraries/Network/RCTNetworking";
import binaryToBase64 from "react-native/Libraries/Utilities/binaryToBase64";
import NativeWebSocketModule from "react-native/Libraries/WebSocket/NativeWebSocketModule";
import type { BlobData, BlobReader, BodyInput, NetworkRecorder } from "./recorder";

// Development bundles only, macOS. Observes React Native's networking modules: RCTNetworking (XMLHttpRequest, and
// fetch, which React Native builds on it) and the WebSocket module, wrapping their JavaScript entry points and listening
// to their events. Nothing about a request changes: every argument reaches the original function as given, events
// reach their listeners as before, and no request option (such as incremental delivery) is added. While nothing
// observes, a wrapper is one property check.

type Subscription = { remove(): void };

/** Reads the first `size` bytes of a native blob, by its id, as React Native's FileReader does; no Blob object is made. */
export const readBlob: BlobReader = async blob => {
  const url = await NativeFileReaderModule.readAsDataURL(blob);
  return url.slice(url.indexOf(",") + 1);
};

/** What a request sends: text, the first `max` bytes of binary data as base64, a native blob, or (FormData, a file URI) nothing readable. */
function requestBody(data: unknown, max: number): BodyInput | undefined {
  if (data === null || data === undefined) return undefined;
  if (typeof data === "string") return { text: data };
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return { base64: binaryToBase64(bytes.subarray(0, max)), size: bytes.byteLength };
  }
  const blob = (data as { data?: BlobData }).data;
  if (blob && typeof blob.blobId === "string") return { blob };
  return { unreadable: true };
}

export function intercept(recorder: NetworkRecorder) {
  /** React Native request id → entry id and the response type its data arrives in. */
  const requests = new Map<number, { id: string; responseType: string }>();
  const sockets = new Map<number, string>();
  let fetching = 0, internal = 0;
  let subscriptions: Subscription[] = [];

  // fetch is React Native's whatwg-fetch, which sends through XMLHttpRequest synchronously: a request sent while this
  // runs comes from fetch.
  const fetch = globalThis.fetch;
  if (typeof fetch === "function") globalThis.fetch = function fetchWithInspection(this: unknown, ...args: Parameters<typeof fetch>) {
    fetching++;
    try { return fetch.apply(this, args); } finally { fetching--; }
  } as typeof fetch;

  const { sendRequest, abortRequest } = RCTNetworking;
  RCTNetworking.sendRequest = function (this: unknown, method, trackingName, url, headers, data, responseType, incrementalUpdates, timeout, callback, withCredentials) {
    if (!recorder.active) return sendRequest.call(this, method, trackingName, url, headers, data, responseType, incrementalUpdates, timeout, callback, withCredentials);
    const id = recorder.request({ source: fetching ? "fetch" : "xhr", method, url, headers, body: requestBody(data, recorder.options.maxBodySize), stack: new Error().stack });
    const reply = id === undefined ? callback : (requestId: number) => { requests.set(requestId, { id, responseType }); callback(requestId); };
    try {
      return sendRequest.call(this, method, trackingName, url, headers, data, responseType, incrementalUpdates, timeout, reply, withCredentials);
    } catch (error) {
      if (id !== undefined) recorder.fail(id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  RCTNetworking.abortRequest = function (this: unknown, requestId) {
    const request = requests.get(requestId);
    if (request) { requests.delete(requestId); recorder.fail(request.id, "canceled", true); }
    return abortRequest.call(this, requestId);
  };

  const { connect, send, sendBinary } = NativeWebSocketModule;
  NativeWebSocketModule.connect = function (this: unknown, url, protocols, options, socketId) {
    if (recorder.active && !internal) {
      const id = recorder.request({ source: "websocket", method: "GET", url, headers: options?.headers, stack: new Error().stack });
      if (id !== undefined) sockets.set(socketId, id);
    }
    return connect.call(this, url, protocols, options, socketId);
  };
  NativeWebSocketModule.send = function (this: unknown, message, socketId) {
    const id = sockets.get(socketId);
    if (id !== undefined) recorder.frame(id, "sent", { text: message });
    return send.call(this, message, socketId);
  };
  NativeWebSocketModule.sendBinary = function (this: unknown, base64, socketId) {
    const id = sockets.get(socketId);
    if (id !== undefined) recorder.frame(id, "sent", { base64 });
    return sendBinary.call(this, base64, socketId);
  };

  const socketEvents = new NativeEventEmitter(NativeWebSocketModule as never);
  // RCTNetworking emits each event's values as one array (Libraries/Network/RCTNetworkingEventDefinitions.flow.js).
  const listen = () => [
    RCTNetworking.addListener("didReceiveNetworkResponse", ([requestId, status, headers, url]: [number, number, Record<string, unknown> | null, string | null]) => {
      const request = requests.get(requestId);
      if (request) recorder.response(request.id, { status, headers: headers ?? {}, url: url ?? undefined });
    }),
    RCTNetworking.addListener("didReceiveNetworkData", ([requestId, data]: [number, unknown]) => {
      const request = requests.get(requestId);
      if (!request) return;
      if (request.responseType === "blob" && data && typeof data === "object") recorder.data(request.id, { blob: data as BlobData });
      else if (typeof data === "string") recorder.data(request.id, request.responseType === "base64" ? { base64: data } : { text: data });
    }),
    RCTNetworking.addListener("didReceiveNetworkIncrementalData", ([requestId, text]: [number, string]) => {
      const request = requests.get(requestId);
      if (request) recorder.data(request.id, { text });
    }),
    RCTNetworking.addListener("didCompleteNetworkResponse", ([requestId, error, timedOut]: [number, string | null, boolean]) => {
      const request = requests.get(requestId);
      if (!request) return;
      requests.delete(requestId);
      if (error) recorder.fail(request.id, timedOut ? "timeout" : error); else recorder.finish(request.id);
    }),
    socketEvents.addListener("websocketOpen", (event: { id: number; protocol?: string }) => {
      const id = sockets.get(event.id);
      if (id !== undefined) recorder.socketOpened(id, event.protocol || undefined);
    }),
    socketEvents.addListener("websocketMessage", (event: { id: number; type: "text" | "binary" | "blob"; data: unknown }) => {
      const id = sockets.get(event.id);
      if (id === undefined) return;
      if (event.type === "blob") recorder.frame(id, "received", { blob: event.data as BlobData });
      else recorder.frame(id, "received", event.type === "binary" ? { base64: event.data as string } : { text: event.data as string });
    }),
    socketEvents.addListener("websocketClosed", (event: { id: number; code: number; reason: string }) => {
      const id = sockets.get(event.id);
      if (id === undefined) return;
      sockets.delete(event.id);
      recorder.socketClosed(id, event.code, event.reason ?? "");
    }),
    socketEvents.addListener("websocketFailed", (event: { id: number; message: string }) => {
      const id = sockets.get(event.id);
      if (id === undefined) return;
      sockets.delete(event.id);
      recorder.socketFailed(id, event.message);
    }),
  ];

  return {
    /** Listens to the modules' events while the recorder is active; forgets every request when it stops. */
    observe(active: boolean) {
      if (active === subscriptions.length > 0) return;
      if (active) { subscriptions = listen(); return; }
      for (const subscription of subscriptions) subscription.remove();
      subscriptions = [];
      requests.clear(); sockets.clear();
    },
    /** Runs `create` (which opens the inspector's own WebSocket) without inspecting that socket. */
    internal<T>(create: () => T): T {
      internal++;
      try { return create(); } finally { internal--; }
    },
  };
}
