// Shared by the runtime AI API and the standalone editable toolkit.
function buildInvocationCommand(tool, prompt, options = {}) {
  if (tool === 'codex') {
    const args = ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check'];
    if (options.codex?.model) args.push('--model', options.codex.model);
    args.push('--config', `model_reasoning_effort=${options.codex?.reasoningEffort ?? 'low'}`, '-');
    return { command: 'codex', args, input: prompt };
  }
  return { command: 'claude', args: ['-p', prompt] };
}
module.exports = { buildInvocationCommand };
