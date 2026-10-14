import { createServer } from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const exec = promisify(execFile);

// Test-only chat-completions fixture. It exercises Spark's real HTTP and file-tool path.
export function fixtureReply(messages: any[], file = 'App.js') {
  const input = JSON.parse(messages.find(message => message.role === 'user').content);
  const prompt = String(input.prompt).toLowerCase();
  if (!/blue|bigger|larger/.test(prompt)) return { content: 'This fixture supports “Make the greeting blue” and “Make the greeting larger”. No edits made.' };
  const tools = messages.filter(message => message.role === 'tool');
  if (tools.length === 0) return { content: null, tool_calls: [{ id: 'read-app', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: file }) } }] };
  if (tools.length === 1) {
    let source = JSON.parse(tools[0].content);
    if (typeof source !== 'string') throw new Error('Fixture expected App.js source');
    if (/blue/.test(prompt)) source = source.replace("color: '#202020'", "color: '#2563eb'");
    if (/bigger|larger/.test(prompt)) source = source.replace('fontSize: 34', 'fontSize: 48');
    return { content: null, tool_calls: [{ id: 'write-app', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: file, content: source }) } }] };
  }
  return { content: 'Applied the deterministic demo edit. Review the complete patch before applying.' };
}

export async function startFixtureProvider(directory: string, file = 'App.js') {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const session = mkdtempSync(path.join(directory, 'session-'));
  const certificate = path.join(session, 'certificate.pem'), key = path.join(session, 'private.key');
  const config = path.join(session, 'openssl.cnf');
  writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=localhost\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n');
  await exec('/usr/bin/openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-config',config,'-keyout',key,'-out',certificate]);
  const server = createServer({ key: readFileSync(key), cert: readFileSync(certificate) }, async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end('{}'); return; }
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 2 * 1024 ** 2) throw new Error('Fixture request too large'); }
      const { messages } = JSON.parse(body);
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...fixtureReply(messages, file) } }] }));
    } catch { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid fixture request' })); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture failed to listen');
  return { endpoint: `https://127.0.0.1:${address.port}/v1/chat/completions`, certificate,
    close: () => new Promise<void>((resolve, reject) => { server.close(error => { rmSync(session, { recursive: true, force: true }); error ? reject(error) : resolve(); }); server.closeAllConnections(); }) };
}
