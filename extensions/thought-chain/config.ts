/** Own config for the thought-chain plugin (independent from other plugins). */

import * as fs from "node:fs";
import type { ThoughtChainConfig } from "./types.ts";
import { configFile, projectConfigFile, writeIfAbsent } from "./lib/paths.ts";

export function defaultConfig(): ThoughtChainConfig {
	return {
		enabled: true,
		default: "react",
		dirs: [],
		routing: { auto: false, threshold: 0.6 },
		tools: { isolate: true },
		phases: { enforceExit: false },
		handoff: { suggest: true },
	};
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
	} catch {
		return undefined;
	}
}

function merge(base: ThoughtChainConfig, override: unknown): ThoughtChainConfig {
	if (!override || typeof override !== "object") return base;
	const o = override as Record<string, unknown>;
	const out: ThoughtChainConfig = { ...base };
	if (typeof o.enabled === "boolean") out.enabled = o.enabled;
	if (o.default === null || typeof o.default === "string") out.default = o.default as string | null;
	if (Array.isArray(o.dirs)) out.dirs = o.dirs.map(String);
	for (const section of ["routing", "tools", "phases", "handoff"] as const) {
		const value = o[section];
		if (value && typeof value === "object") {
			out[section] = { ...(base[section] as object), ...(value as object) } as never;
		}
	}
	return out;
}

let cached: ThoughtChainConfig | undefined;
let cachedCwd: string | undefined;

export function loadConfig(cwd: string, force = false): ThoughtChainConfig {
	if (!force && cached && cachedCwd === cwd) return cached;
	let cfg = defaultConfig();
	writeIfAbsent(configFile(), JSON.stringify(defaultConfig(), null, 2));
	cfg = merge(cfg, readJson(configFile()));
	cfg = merge(cfg, readJson(projectConfigFile(cwd)));
	if (process.env.PI_THOUGHT_CHAIN === "0" || process.env.PI_THOUGHT_CHAIN === "false") {
		cfg = { ...cfg, enabled: false };
	}
	cached = cfg;
	cachedCwd = cwd;
	return cfg;
}

export function invalidateConfigCache(): void {
	cached = undefined;
	cachedCwd = undefined;
}
