import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const worker = require('../packages/cli/src/editable-worker.cjs');
const github = require('../packages/cli/src/editable-github.cjs');
const bytes = (text: string) => Buffer.from(text).toString('base64');
const sha = 'a'.repeat(40), tree = 'b'.repeat(40);
const response = (value: object, status = 200) => ({ ok: status < 400, status, json: async () => value });
let history: any[], manifest: any, changed: any[], calls: Array<{ url: string; body: any; options: any }>;
beforeEach(() => {
  calls = []; history = [{ id: 'prompt-1', candidate: 'candidate', prompt: 'Make the greeting blue', status: 'needs-review' }];
  manifest = { repository: 'owner/app', repositoryDirectory: 'apps/app', project: 'App', version: '1' };
  changed = [{ path: 'src/App.tsx', before: bytes('original\n'), after: bytes('blue\n') }];
  vi.spyOn(worker, 'read').mockImplementation((file: any) => String(file).endsWith('manifest.json') ? manifest : { history });
  vi.spyOn(worker, 'verify').mockReturnValue({ candidate: 'candidate' });
  vi.spyOn(worker, 'snapshot').mockReturnValue({}); vi.spyOn(worker, 'patch').mockImplementation(() => changed);
});
afterEach(() => vi.restoreAllMocks());
function fetcher(stale = false, fork = false) {
  return vi.fn(async (url: string, options: any) => {
    const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ url, body, options });
    if (url.endsWith('/user')) return response({ login: fork ? 'user' : 'owner' });
    if (url.endsWith('/repos/owner/app')) return response({ full_name: 'owner/app', default_branch: 'main', private: false });
    if (url.includes('/git/ref/heads/')) return response({ object: { sha } });
    if (url.includes('/git/commits/') && !body) return response({ tree: { sha: tree } });
    if (url.includes('?recursive=1')) return response({ tree: [{ path: 'apps/app/src/App.tsx', type: 'blob', mode: '100644', sha: stale ? sha : github.blobHash(bytes('original\n')) }] });
    if (url.endsWith('/forks')) return response({ full_name: 'user/app', owner: { login: 'user' }, parent: { full_name: 'owner/app' } });
    if (url.endsWith('/pulls')) return response({ html_url: 'https://github.com/owner/app/pull/42', number: 42 });
    return response({ sha });
  });
}
describe('GitHub editing publication', () => {
  it.each([false, true])('publishes a reviewed cumulative patch and prompts with repository paths (fork: %s)', async fork => {
    const transport = fetcher(false, fork);
    const result = await github.submit('/editing', { title: 'Blue greeting' }, 'secret-token', { fetcher: transport });
    expect(result).toMatchObject({ number: 42, repository: 'owner/app' });
    const destination = fork ? 'user/app' : 'owner/app';
    expect(calls.find(call => call.url === `https://api.github.com/repos/${destination}/git/trees`)?.body.tree).toEqual([{ path: 'apps/app/src/App.tsx', mode: '100644', type: 'blob', sha }]);
    const pull = calls.find(call => call.url.endsWith('/pulls'))!;
    expect(pull.body.body).toContain('Make the greeting blue'); expect(pull.body.body).toContain('+blue'); expect(pull.body.body).not.toContain('secret-token');
    expect(pull.body.base).toBe('main'); expect(pull.body.head).toMatch(new RegExp(`^${fork ? 'user' : 'owner'}:spark-customize-`));
    for (const call of calls) { expect(call.options.redirect).toBe('error'); expect(call.options.headers.Authorization).toBe('Bearer secret-token'); }
  });
  it('rejects stale upstream source without any remote writes', async () => {
    await expect(github.submit('/editing', { title: 'Change' }, 'token', { fetcher: fetcher(true) })).rejects.toMatchObject({ code: 'E_INVALID_DATA' });
    expect(calls.every(call => call.body === undefined)).toBe(true);
  });
  it('rejects oversized prompts before any remote requests', async () => {
    history[0].prompt = 'x'.repeat(61000);
    const transport = fetcher(); await expect(github.submit('/editing', { title: 'Change' }, 'token', { fetcher: transport })).rejects.toMatchObject({ code: 'E_INVALID_ARGUMENT' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('preserves deletions and validates raw repository path traversal', async () => {
    changed[0].after = null;
    await github.submit('/editing', { title: 'Delete greeting' }, 'token', { fetcher: fetcher() });
    expect(calls.find(call => call.url.endsWith('/git/trees'))?.body.tree[0].sha).toBeNull();
    for (const value of ['../outside', 'src/../../outside', '/outside', '.git/config', 'src\\secret']) expect(() => github.repositoryPath('', value)).toThrow();
    expect(() => github.repositoryPath('../repo', 'App.tsx')).toThrow();
  });
});
describe('GitHub device authorization', () => {
  it('requests public repository scope and checks device response', async () => {
    const transport = vi.fn(async () => response({ device_code: 'device', user_code: 'ABCD', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }));
    expect(await github.begin('client', transport)).toMatchObject({ deviceCode: 'device', userCode: 'ABCD', interval: 5 });
    expect(JSON.parse((transport.mock.calls[0] as any)[1].body).scope).toBe('public_repo');
    expect((transport.mock.calls[0] as any)[1].headers.Accept).toBe('application/json');
    await expect(github.begin('', transport)).rejects.toMatchObject({ code: 'E_INVALID_ARGUMENT' });
    await expect(github.begin('client', async () => response({}))).rejects.toMatchObject({ code: 'E_INVALID_DATA' });
  });
  it('respects interval and slow_down and only returns token to native transport', async () => {
    let now = 0; const delays: number[] = [];
    const transport = vi.fn().mockResolvedValueOnce(response({ error: 'authorization_pending' })).mockResolvedValueOnce(response({ error: 'slow_down' })).mockResolvedValueOnce(response({ access_token: 'secret' }));
    const result = await github.complete({ clientId: 'client', deviceCode: 'device', expiresAt: 100000, interval: 5 }, { fetcher: transport, now: () => now, wait: async (ms: number) => { delays.push(ms); now += ms; } });
    expect(delays).toEqual([5000, 5000, 10000]); expect(result).toEqual({ token: 'secret' });
    expect(transport.mock.calls.every(call => call[1].headers.Accept === 'application/json')).toBe(true);
  });
  it('reports authorization denial and expiry', async () => {
    const session = { clientId: 'client', deviceCode: 'device', expiresAt: 10000, interval: 5 };
    await expect(github.complete(session, { now: () => 0, wait: async () => {}, fetcher: async () => response({ error: 'access_denied' }) })).rejects.toMatchObject({ code: 'E_PERMISSION_DENIED' });
    await expect(github.complete(session, { now: () => 10000 })).rejects.toMatchObject({ code: 'E_TIMEOUT' });
  });
});
