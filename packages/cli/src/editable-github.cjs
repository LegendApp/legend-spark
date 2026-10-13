// GitHub publication stays in Spark's trusted toolkit, outside the AI workspace.
const crypto = require('node:crypto');
const path = require('node:path');
const worker = require('./editable-worker.cjs');
const fail = (code, message) => Object.assign(new Error(message), { code });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(url, body, token, fetcher = fetch) {
  const response = await fetcher(url, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Accept: url.startsWith('https://github.com/login/') ? 'application/json' : 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let value;
  try { value = await response.json(); } catch { throw fail('E_INVALID_DATA', 'GitHub returned invalid JSON'); }
  if (!response.ok) throw fail(response.status === 401 || response.status === 403 ? 'E_PERMISSION_DENIED' : 'E_NATIVE', `GitHub request failed (${response.status})`);
  if (!value || typeof value !== 'object') throw fail('E_INVALID_DATA', 'GitHub returned invalid data');
  return value;
}
function clientId(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(value)) throw fail('E_INVALID_ARGUMENT', 'Configure editable.githubClientId with a device-flow-enabled GitHub OAuth app'); return value; }
async function begin(id, fetcher) {
  const value = await request('https://github.com/login/device/code', { client_id: clientId(id), scope: 'public_repo' }, undefined, fetcher);
  if (typeof value.device_code !== 'string' || !value.device_code || typeof value.user_code !== 'string' || !value.user_code || value.verification_uri !== 'https://github.com/login/device' || !Number.isSafeInteger(value.expires_in) || value.expires_in <= 0 || !Number.isSafeInteger(value.interval) || value.interval <= 0) throw fail('E_INVALID_DATA', 'GitHub returned invalid device authorization');
  return { clientId: id, deviceCode: value.device_code, userCode: value.user_code, verificationUri: value.verification_uri, expiresIn: value.expires_in, expiresAt: Date.now() + value.expires_in * 1000, interval: value.interval };
}
async function complete(session, { fetcher, wait = sleep, now = Date.now } = {}) {
  clientId(session.clientId);
  if (typeof session.deviceCode !== 'string' || !session.deviceCode || !Number.isFinite(session.expiresAt) || !Number.isSafeInteger(session.interval) || session.interval <= 0) throw fail('E_INVALID_ARGUMENT', 'Start GitHub authorization first');
  let interval = session.interval * 1000;
  while (now() < session.expiresAt) {
    if (now() + interval >= session.expiresAt) break;
    await wait(interval);
    const value = await request('https://github.com/login/oauth/access_token', { client_id: session.clientId, device_code: session.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, undefined, fetcher);
    if (typeof value.access_token === 'string' && value.access_token) return { token: value.access_token };
    if (value.error === 'slow_down') interval += 5000;
    else if (value.error !== 'authorization_pending') throw fail(value.error === 'expired_token' ? 'E_TIMEOUT' : 'E_PERMISSION_DENIED', 'GitHub device authorization was denied or expired');
  }
  throw fail('E_TIMEOUT', 'GitHub device authorization expired');
}
function blobHash(base64) { const bytes = Buffer.from(base64, 'base64'); return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
function repositoryPath(prefix, name) {
  if (typeof name !== 'string' || !name || typeof (prefix ?? '') !== 'string' || [prefix || '', name].some(part => part && (part.startsWith('/') || part.includes('\\') || part.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment === '.git')))) throw fail('E_INVALID_DATA', 'Invalid repository patch path');
  const value = path.posix.join(prefix || '', name);
  return value;
}
async function submit(directory, options, token, { fetcher, wait = sleep } = {}) {
  if (!token) throw fail('E_PERMISSION_DENIED', 'Sign in to GitHub before submitting');
  if (options && Object.keys(options).some(key => key !== 'title')) throw fail('E_UNSUPPORTED_OPTION', 'Unknown pull request option');
  if (!options || typeof options.title !== 'string' || !options.title.trim() || options.title.length > 256) throw fail('E_INVALID_ARGUMENT', 'Enter a PR title of at most 256 characters');
  const manifest = worker.read(path.join(directory, 'manifest.json'));
  if (!/^[\w.-]+\/[\w.-]+$/.test(manifest.repository || '')) throw fail('E_INVALID_DATA', 'Editable release has no target repository');
  const ready = worker.verify(directory); // Only publish the exact candidate that passed build/review checks.
  const source = ready.candidate === 'work' ? path.join(directory, 'work') : worker.safe(path.join(directory, 'candidates'), ready.candidate);
  const changes = worker.patch(worker.snapshot(path.join(directory, 'base')), worker.snapshot(source));
  if (!changes.length) throw fail('E_INVALID_ARGUMENT', 'There are no changes to submit');
  for (const change of changes) change.repositoryPath = repositoryPath(manifest.repositoryDirectory, change.path);
  const state = worker.read(path.join(directory, 'state.json'));
  const relevant = new Set();
  const current = state.history?.find(item => item.candidate === ready.candidate);
  for (const id of current?.ancestors || []) relevant.add(id);
  if (current) relevant.add(current.id);
  const prompts = [...(state.inheritedPrompts || []), ...(state.history || []).filter(item => item.status === 'accepted' || relevant.has(item.id))].map(item => item.prompt).filter(value => typeof value === 'string' && value);
  const patch = worker.reviewPatch(changes.map(change => ({ ...change, path: change.repositoryPath })));
  const body = `Submitted from ${manifest.project} ${manifest.version}.\n\n## User prompts\n\n${prompts.map(prompt => `> ${prompt.replace(/\n/g, '\n> ')}`).join('\n\n')}\n\n## Patch\n\n\`\`\`diff\n${patch.replace(/\`\`\`/g, '\`\`\u200b\`')}\n\`\`\``;
  if (body.length > 60000) throw fail('E_INVALID_ARGUMENT', 'Prompt and patch exceed GitHub PR body limit');
  let repo = manifest.repository;
  const api = endpoint => `https://api.github.com/${endpoint}`;
  const get = endpoint => request(api(endpoint), undefined, token, fetcher);
  const post = (endpoint, body) => request(api(endpoint), body, token, fetcher);
  const [user, upstream] = await Promise.all([get('user'), get(`repos/${repo}`)]);
  if (!/^[\w-]+$/.test(user.login || '') || typeof upstream.full_name !== 'string' || upstream.full_name.toLowerCase() !== repo.toLowerCase() || typeof upstream.default_branch !== 'string' || !upstream.default_branch || upstream.private !== false) throw fail('E_INVALID_DATA', 'GitHub returned an invalid public target repository');
  repo = upstream.full_name;
  const ref = await get(`repos/${repo}/git/ref/heads/${encodeURIComponent(upstream.default_branch)}`);
  const sha = ref.object?.sha;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw fail('E_INVALID_DATA', 'GitHub returned an invalid base commit');
  const commit = await get(`repos/${repo}/git/commits/${sha}`);
  if (!/^[a-f0-9]{40}$/.test(commit.tree?.sha || '')) throw fail('E_INVALID_DATA', 'GitHub returned an invalid base tree');
  const tree = await get(`repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw fail('E_INVALID_DATA', 'GitHub base tree is incomplete; cannot safely submit');
  const entries = new Map(tree.tree.map(item => [item.path, item]));
  for (const change of changes) {
    const entry = entries.get(change.repositoryPath);
    if (change.before === null ? !!entry : !entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || entry.sha !== blobHash(change.before)) throw fail('E_INVALID_DATA', `Upstream changed ${change.repositoryPath}; update the app before submitting`);
    const parts = change.repositoryPath.split('/');
    for (let count = 1; count < parts.length; count++) {
      const parent = entries.get(parts.slice(0, count).join('/'));
      if (parent && parent.type !== 'tree') throw fail('E_INVALID_DATA', `Upstream changed the directory for ${change.repositoryPath}; update the app before submitting`);
    }
  }
  let destination = repo;
  if (repo.split('/')[0].toLowerCase() !== user.login.toLowerCase()) {
    const fork = await post(`repos/${repo}/forks`, { default_branch_only: true });
    if (fork.owner?.login !== user.login || !/^[\w.-]+\/[\w.-]+$/.test(fork.full_name || '') || fork.parent?.full_name?.toLowerCase() !== repo.toLowerCase()) throw fail('E_INVALID_DATA', 'GitHub returned an unrelated fork');
    destination = fork.full_name;
    // Fork creation is asynchronous. Bound the wait and only retry reads.
    let available = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      try { await get(`repos/${destination}/git/commits/${sha}`); available = true; break; }
      catch (error) { if (error.code !== 'E_NATIVE') throw error; if (attempt < 11) await wait(5000); }
    }
    if (!available) throw fail('E_TIMEOUT', 'GitHub fork is not ready; retry submission later');
  }
  const files = [];
  for (const change of changes) {
    let blob = null;
    if (change.after !== null) {
      const result = await post(`repos/${destination}/git/blobs`, { encoding: 'base64', content: change.after });
      if (!/^[a-f0-9]{40}$/.test(result.sha || '')) throw fail('E_INVALID_DATA', 'GitHub returned an invalid blob');
      blob = result.sha;
    }
    files.push({ path: change.repositoryPath, mode: entries.get(change.repositoryPath)?.mode || '100644', type: 'blob', sha: blob });
  }
  const newTree = await post(`repos/${destination}/git/trees`, { base_tree: commit.tree.sha, tree: files });
  if (!/^[a-f0-9]{40}$/.test(newTree.sha || '')) throw fail('E_INVALID_DATA', 'GitHub returned an invalid tree');
  const newCommit = await post(`repos/${destination}/git/commits`, { message: options.title.trim(), tree: newTree.sha, parents: [sha] });
  if (!/^[a-f0-9]{40}$/.test(newCommit.sha || '')) throw fail('E_INVALID_DATA', 'GitHub returned an invalid commit');
  const branch = `spark-customize-${crypto.randomUUID()}`;
  await post(`repos/${destination}/git/refs`, { ref: `refs/heads/${branch}`, sha: newCommit.sha });
  const result = await post(`repos/${repo}/pulls`, { title: options.title.trim(), body, head: `${user.login}:${branch}`, base: upstream.default_branch, maintainer_can_modify: true });
  if (typeof result.html_url !== 'string' || !result.html_url.startsWith(`https://github.com/${repo}/pull/`) || !Number.isSafeInteger(result.number)) throw fail('E_INVALID_DATA', 'GitHub returned an invalid pull request');
  return { url: result.html_url, number: result.number, repository: repo, branch };
}
module.exports = { begin, complete, submit, blobHash, repositoryPath };
if (require.main === module) {
  (async () => {
    const [command, directory] = process.argv.slice(2);
    const input = JSON.parse(process.env.SPARK_EDITABLE_GITHUB_REQUEST || '{}');
    let result;
    if (command === 'begin') result = await begin(input.clientId);
    else if (command === 'complete') result = await complete(input);
    else if (command === 'submit') result = await submit(directory, input, process.env.SPARK_EDITABLE_GITHUB_TOKEN);
    else throw fail('E_INVALID_ARGUMENT', 'Unknown GitHub editing operation');
    console.log(JSON.stringify(result));
  })().catch(error => { console.error(JSON.stringify({ error: error.code || 'E_NATIVE', message: error.code ? error.message : 'GitHub operation failed' })); process.exitCode = 1; });
}
