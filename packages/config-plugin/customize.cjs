const path = require('node:path');
function validateCustomize(value) {
  if (value === undefined || value === false) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('customize must be false or an object');
  const allowed = ['repository', 'tag', 'files', 'sourceRoot', 'githubClientId', 'toolkitRepository', 'toolkitTag', 'ui', 'provider'];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown customize option: ${key}`);
  for (const key of ['repository', 'toolkitRepository']) if ((key === 'repository' || value[key] !== undefined) && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value[key] ?? '')) throw new Error(`customize.${key} must be owner/repository`);
  for (const key of ['tag', 'toolkitTag']) if (value[key] !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value[key])) throw new Error(`customize.${key} must be a fixed release tag`);
  if (!Array.isArray(value.files) || !value.files.length || value.files.some(file => typeof file !== 'string' || !file || path.isAbsolute(file) || file.split(/[\\/]/).some(part => !part || part === '..' || (part.startsWith('.') && !/^\.babelrc(?:\.[cm]?js|\.json)?$/.test(part)) || ['node_modules', 'macos', 'ios', 'android', 'windows'].includes(part)))) throw new Error('customize.files must explicitly list relative source files/directories, without hidden files or native projects');
  if (value.sourceRoot !== undefined && (typeof value.sourceRoot !== 'string' || !value.sourceRoot || path.isAbsolute(value.sourceRoot) || value.sourceRoot.includes('\\') || value.sourceRoot.split('/').some(part => !part || (part !== '.' && part !== '..')))) throw new Error('customize.sourceRoot must be a relative ancestor of the app project (for example ../..)');
  if (value.githubClientId !== undefined && (typeof value.githubClientId !== 'string' || !/^[A-Za-z0-9_]+$/.test(value.githubClientId))) throw new Error('customize.githubClientId must be a GitHub OAuth app client ID');
  if (value.ui !== undefined && !['default', 'custom'].includes(value.ui)) throw new Error('customize.ui must be default or custom');
  if (value.provider !== undefined) require('./customize-provider.cjs').validateProvider(value.provider);
  return value;
}
module.exports = { validateCustomize };
