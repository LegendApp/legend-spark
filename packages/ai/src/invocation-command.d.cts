import type { AIInvocation, AIInvocationOptions, AIToolId } from "./types";
export function buildInvocationCommand(tool: AIToolId, prompt: string, options?: AIInvocationOptions): AIInvocation;
