const path = require('node:path');
function validateEditable(value) {
  if (value === undefined || value === false) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('editable must be false or an object');
  const allowed = ['repository', 'tag', 'files', 'toolkitRepository', 'toolkitTag'];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown editable option: ${key}`);
  for (const key of ['repository', 'toolkitRepository']) if ((key === 'repository' || value[key] !== undefined) && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value[key] ?? '')) throw new Error(`editable.${key} must be owner/repository`);
  for (const key of ['tag', 'toolkitTag']) if (value[key] !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value[key])) throw new Error(`editable.${key} must be a fixed release tag`);
  if (!Array.isArray(value.files) || !value.files.length || value.files.some(file => typeof file !== 'string' || !file || path.isAbsolute(file) || file.split(/[\\/]/).some(part => !part || part === '..' || part.startsWith('.') || ['node_modules', 'macos', 'ios', 'android', 'windows'].includes(part)))) throw new Error('editable.files must explicitly list relative source files/directories, without hidden files or native projects');
  return value;
}
module.exports = { validateEditable };
