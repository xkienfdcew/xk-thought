/** Path resolution. Zero dependencies. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function ensureDir(dir: string): string {
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** pi config dir. Mirrors pi's PI_CODING_AGENT_DIR (default ~/.pi/agent). */
export function agentDir(): string {
	const env = process.env.PI_CODING_AGENT_DIR;
	if (env && env.trim().length > 0) return env.trim();
	return path.join(os.homedir(), ".pi", "agent");
}

export function thoughtChainDir(): string {
	return path.join(agentDir(), "thought-chain");
}

export function configFile(): string {
	return path.join(thoughtChainDir(), "config.json");
}

export function projectConfigFile(cwd: string): string {
	return path.join(cwd, ".pi", "thought-chain.json");
}

/** User-level chains (shared with the legacy autonomy layout). */
export function chainsDir(): string {
	return path.join(agentDir(), "chains");
}

/** Project-level chains (loaded only for trusted projects by pi). */
export function projectChainsDir(cwd: string): string {
	return path.join(cwd, ".pi", "chains");
}

export function writeIfAbsent(file: string, content: string): boolean {
	try {
		ensureDir(path.dirname(file));
		fs.writeFileSync(file, content, { encoding: "utf-8", flag: "wx" });
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw err;
	}
}
