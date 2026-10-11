export type SubagentRequest = { description: string; prompt: string };

type Runner = (req: SubagentRequest) => Promise<string>;

let runner: Runner | null = null;

/**
 * Lets the tools service reach the chat service without importing it.
 *
 * The two modules already depend on each other at runtime, and a direct import
 * in either direction closes the loop, which breaks the module bundler.
 */
export function registerSubagentRunner(fn: Runner): void {
	runner = fn;
}

export async function runSubagent(req: SubagentRequest): Promise<string> {
	if (!runner) {
		return 'Subagents are unavailable right now.';
	}
	return runner(req);
}