// Shared by release configuration and the downloaded editing worker.
function validateProvider(value) {
  if (value?.kind === 'cli') {
    if (!['codex', 'claude'].includes(value.tool) || (value.model !== undefined && (typeof value.model !== 'string' || (!value.model.trim() || /[\0\r\n]/.test(value.model)))) || Object.keys(value).some(key => !['kind', 'tool', 'model'].includes(key))) throw new Error('CLI editing provider requires codex or claude and an optional model');
    return { kind: 'cli', tool: value.tool, ...(value.model ? { model: value.model } : {}) };
  }
  if (!value || !['local', 'remote'].includes(value.kind) || typeof value.model !== 'string' || (!value.model.trim() || /[\0\r\n]/.test(value.model))) throw new Error('Editing provider requires kind, endpoint and model');
  if (Object.keys(value).some(key => !['kind', 'endpoint', 'model'].includes(key))) throw new Error('Unknown editing provider option; never publish API keys');
  const url = new URL(value.endpoint);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (value.kind === 'local' ? !loopback || !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:')) throw new Error('Remote editing requires HTTPS; local editing requires a loopback HTTP(S) endpoint without credentials, query or fragment');
  // Do not resolve localhost through DNS or a modified hosts file.
  if (value.kind === 'local' && url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return { kind: value.kind, endpoint: url.href, model: value.model };
}
module.exports = { validateProvider };
