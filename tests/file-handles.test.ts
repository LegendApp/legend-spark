import { expect, test } from "vitest";
import { createFileHandle, iterateFile, writeFileChunks, MAX_CHUNK_SIZE, type FileCall } from "../packages/file-system/src/handles.ts";
function backend() {
  let data = new Uint8Array([0, 1, 2, 255]), closed = 0, reads = 0, writes = 0;
  const call: FileCall = async <T>(method: string, args: any): Promise<T> => {
    let result: unknown;
    if (method === 'openFile') result = 'owned-handle';
    if (method === 'readChunk') { reads++; result = data.slice(args.offset, args.offset + args.length).buffer; }
    if (method === 'writeChunk') { writes++; const bytes = args.bytes as Uint8Array; const next = new Uint8Array(Math.max(data.length, args.offset + bytes.length)); next.set(data); next.set(bytes, args.offset); data = next; result = bytes.length; }
    if (method === 'closeFile') closed++;
    return result as T;
  };
  return { call, get data() { return data; }, get closed() { return closed; }, get reads() { return reads; }, get writes() { return writes; } };
}
test('binary positional I/O and close ordering', async () => {
  const native = backend(), file = await createFileHandle(native.call, '/file', 'readWrite');
  expect(await file.read(2, 2)).toEqual(new Uint8Array([2, 255]));
  await file.write(new Uint8Array([128, 0]), 1); expect(await file.read(4, 0)).toEqual(new Uint8Array([0, 128, 0, 255]));
  await Promise.all([file.close(), file.close()]); expect(native.closed).toBe(1);
  await expect(file.read(1, 0)).rejects.toThrow('closed');
});
test('read iteration is pull based and closes on break', async () => {
  const native = backend();
  for await (const bytes of iterateFile(() => createFileHandle(native.call, '/file'), { chunkSize: 2 })) { expect(bytes.length).toBe(2); expect(native.reads).toBe(1); break; }
  expect(native.closed).toBe(1); expect(native.reads).toBe(1);
});
test('abort and read failure both release handles', async () => {
  const native = backend(), controller = new AbortController();
  await expect((async () => { for await (const bytes of iterateFile(() => createFileHandle(native.call, '/file'), { chunkSize: 1, signal: controller.signal })) { controller.abort(new Error('cancelled')); } })()).rejects.toThrow('cancelled');
  expect(native.closed).toBe(1);
  const bad: FileCall = (method, args) => method === 'readChunk' ? Promise.reject(new Error('disk failed')) : native.call(method, args);
  await expect((async () => { for await (const bytes of iterateFile(() => createFileHandle(bad, '/file'))) {} })()).rejects.toThrow('disk failed');
  expect(native.closed).toBe(2);
});
test('streaming writer splits chunks, preserves bytes, and closes when the source fails', async () => {
  const native = backend(); const bytes = new Uint8Array(MAX_CHUNK_SIZE + 7).fill(231);
  expect(await writeFileChunks(() => createFileHandle(native.call, '/file', 'write'), [bytes])).toBe(bytes.length);
  expect(native.writes).toBe(2); expect(native.data).toEqual(bytes); expect(native.closed).toBe(1);
  async function* broken() { yield new Uint8Array([1]); throw Error('source failed'); }
  await expect(writeFileChunks(() => createFileHandle(native.call, '/file', 'write'), broken())).rejects.toThrow('source failed'); expect(native.closed).toBe(2);
});
test('invalid ranges never cross the native boundary', async () => {
  const native = backend(), file = await createFileHandle(native.call, '/file');
  for (const length of [0, -1, Infinity, 1.5, MAX_CHUNK_SIZE + 1]) await expect(file.read(length, 0)).rejects.toThrow();
  await expect(file.read(1, Number.MAX_SAFE_INTEGER)).rejects.toThrow();
  await expect(file.write(new Uint8Array([1]), -1)).rejects.toThrow();
  expect(native.reads).toBe(0); expect(native.writes).toBe(0); await file.close();
});

test('close joins pending cleanup, blocks new IO and retries failure', async () => {
  const native = backend(); let attempts = 0;
  const call: FileCall = (method, args) => {
    if (method === 'closeFile' && ++attempts === 1) return Promise.reject(new Error('temporary failure'));
    return native.call(method, args);
  };
  const file = await createFileHandle(call, '/file');
  const closing = file.close(); expect(file.close()).toBe(closing);
  await expect(closing).rejects.toThrow('temporary failure');
  await expect(file.read(1, 0)).rejects.toMatchObject({ code: 'E_CLOSED' });
  await file.close(); await file.close(); expect(attempts).toBe(2);
});
test('short writes and malformed reads reject instead of losing data silently', async () => {
  const native = backend();
  const short: FileCall = async <T>(method: string, args: object): Promise<T> => method === 'writeChunk' ? 1 as T : native.call(method, args);
  const file = await createFileHandle(short, '/file', 'readWrite');
  await expect(file.write(new Uint8Array([1, 2]), 0)).rejects.toMatchObject({ code: 'E_NATIVE' });
  await file.close();
  const bad: FileCall = async <T>(method: string, args: object): Promise<T> => method === 'readChunk' ? 'not a native buffer' as T : native.call(method, args);
  const broken = await createFileHandle(bad, '/file');
  await expect(broken.read(3, 0)).rejects.toMatchObject({ code: 'E_INVALID_DATA' });
  await broken.close();
});
