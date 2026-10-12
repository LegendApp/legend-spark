// React Native 0.81 modules the network inspector observes. React Native ships no types for these paths; these
// declare the parts the inspector uses, as Libraries/Network/RCTNetworking.ios.js and the module specs define them.
declare module "react-native/Libraries/Network/RCTNetworking" {
  const RCTNetworking: {
    sendRequest(method: string, trackingName: string | undefined, url: string, headers: Record<string, unknown>, data: unknown, responseType: string,
      incrementalUpdates: boolean, timeout: number, callback: (requestId: number) => void, withCredentials: boolean): void;
    abortRequest(requestId: number): void;
    addListener(eventType: string, listener: (args: any) => unknown): { remove(): void };
  };
  export default RCTNetworking;
}
declare module "react-native/Libraries/WebSocket/NativeWebSocketModule" {
  const NativeWebSocketModule: {
    connect(url: string, protocols: string[] | null | undefined, options: { headers?: Record<string, unknown> } | null | undefined, socketId: number): void;
    send(message: string, socketId: number): void;
    sendBinary(base64String: string, socketId: number): void;
  };
  export default NativeWebSocketModule;
}
declare module "react-native/Libraries/Blob/NativeFileReaderModule" {
  const NativeFileReaderModule: { readAsDataURL(data: object): Promise<string> };
  export default NativeFileReaderModule;
}
declare module "react-native/Libraries/Utilities/binaryToBase64" {
  export default function binaryToBase64(data: ArrayBuffer | ArrayBufferView): string;
}
declare module "react-native/Libraries/Core/Devtools/getDevServer" {
  export default function getDevServer(): { url: string; fullBundleUrl: string | null; bundleLoadedFromServer: boolean };
}
