/** Chain discovery, normalization (with legacy aliases) and `extends` merging. */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ChainDef,
	ChainHandoff,
	ChainLoadResult,
	ChainModelPref,
	ChainOutput,
	ChainPermissions,
	ChainTools,
	ChainWhen,
	PhaseDef,
	ThinkingLevel,
} from "./types.ts";
import { parseFrontmatter } from "./lib/frontmatter.ts";
import { chainsDir, projectChainsDir } from "./lib/paths.ts";

const BUILTIN_DIR = fileURLToPath(new URL("../../chains/builtin", import.meta.url));
const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const APPROVAL_LEVELS = new Set(["none", "on-write", "always"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const arr = value.map(String).filter(Boolean);
		return arr.length ? arr : undefined;
	}
	if (typeof value === "string" && value.trim()) return value.split(",").map((s) => s.trim()).filter(Boolean);
	return undefined;
}

function asThinking(value: unknown): ThinkingLevel | undefined {
	return typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;
}

function asTools(value: unknown): ChainTools | undefined {
	if (!isRecord(value)) return undefined;
	const tools: ChainTools = { base: asArray(value.base), add: asArray(value.add), remove: asArray(value.remove) };
	return tools.base || tools.add || tools.remove ? tools : undefined;
}

function asOutput(value: unknown): ChainOutput | undefined {
	if (!isRecord(value)) return undefined;
	const out: ChainOutput = {
		template: typeof value.template === "string" ? value.template : undefined,
		hint: typeof value.hint === "string" ? value.hint : undefined,
	};
	return out.template || out.hint ? out : undefined;
}

function asPermissions(value: unknown): ChainPermissions | undefined {
	if (!isRecord(value)) return undefined;
	const p: ChainPermissions = {};
	for (const key of ["unattended", "sideEffects", "subagents", "network", "write", "shell"] as const) {
		if (typeof value[key] === "boolean") p[key] = value[key] as boolean;
	}
	if (typeof value.maxSubagents === "number") p.maxSubagents = value.maxSubagents;
	if (typeof value.approval === "string" && APPROVAL_LEVELS.has(value.approval)) {
		p.approval = value.approval as ChainPermissions["approval"];
	}
	if (isRecord(value.budget)) {
		const budget: { maxTokens?: number; maxWallClockMs?: number } = {};
		if (typeof value.budget.maxTokens === "number") budget.maxTokens = value.budget.maxTokens;
		if (typeof value.budget.maxWallClockMs === "number") budget.maxWallClockMs = value.budget.maxWallClockMs;
		if (Object.keys(budget).length) p.budget = budget;
	}
	return Object.keys(p).length ? p : undefined;
}

function asWhen(value: unknown): ChainWhen | undefined {
	if (!isRecord(value)) return undefined;
	const when: ChainWhen = {
		keywords: asArray(value.keywords),
		fileGlobs: asArray(value.fileGlobs),
		taskTypes: asArray(value.taskTypes),
		always: typeof value.always === "boolean" ? value.always : undefined,
	};
	return when.keywords || when.fileGlobs || when.taskTypes || when.always !== undefined ? when : undefined;
}

function asHandoff(value: unknown, warnings: string[]): ChainHandoff[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: ChainHandoff[] = [];
	for (const entry of value) {
		if (typeof entry === "string" && entry.trim()) {
			out.push({ chain: entry.trim() });
			continue;
		}
		if (isRecord(entry) && typeof entry.chain === "string" && entry.chain.trim()) {
			const item: ChainHandoff = { chain: entry.chain.trim() };
			if (typeof entry.when === "string") item.when = entry.when;
			if (isRecord(entry.inputs)) {
				item.inputs = Object.fromEntries(Object.entries(entry.inputs).map(([k, v]) => [k, String(v)]));
			}
			out.push(item);
			continue;
		}
		warnings.push(`handoff entry ignored (expected string or { chain })`);
	}
	return out.length ? out : undefined;
}

function asModel(value: unknown): ChainModelPref | undefined {
	if (!isRecord(value)) return undefined;
	const model: ChainModelPref = {
		prefer: asArray(value.prefer),
		avoid: asArray(value.avoid),
		kind: value.kind === "reasoning" || value.kind === "fast" ? value.kind : undefined,
	};
	return model.prefer || model.avoid || model.kind ? model : undefined;
}

function asPhases(value: unknown, warnings: string[]): PhaseDef[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const phases: PhaseDef[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		const id = typeof entry.id === "string" ? entry.id.trim() : "";
		if (!id) {
			warnings.push("phase ignored: missing id");
			continue;
		}
		if (seen.has(id)) {
			warnings.push(`duplicate phase id "${id}" ignored`);
			continue;
		}
		seen.add(id);
		phases.push({
			id,
			prompt: typeof entry.prompt === "string" ? entry.prompt : "",
			enter: typeof entry.enter === "string" ? entry.enter : undefined,
			exit: typeof entry.exit === "string" ? entry.exit : undefined,
			tools: asTools(entry.tools),
			output: asOutput(entry.output),
		});
	}
	return phases.length ? phases : undefined;
}

export interface NormalizeResult {
	chain?: ChainDef;
	warnings: string[];
}

/** Normalize frontmatter into a ChainDef, accepting legacy field names. */
export function normalizeChain(data: Record<string, unknown>, body: string, sourcePath: string, fallbackName: string): NormalizeResult {
	const warnings: string[] = [];
	const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallbackName;
	if (!name) return { warnings: ["missing chain name"] };

	if (data.triggers !== undefined && data.when === undefined) {
		warnings.push("`triggers` is deprecated; use `when`");
		data = { ...data, when: data.triggers };
	}
	const toolsRaw = isRecord(data.tools) ? { ...data.tools } : undefined;
	if (toolsRaw) {
		if (toolsRaw.extra !== undefined && toolsRaw.add === undefined) {
			warnings.push("`tools.extra` is deprecated; use `tools.add`");
			toolsRaw.add = toolsRaw.extra;
		}
		if (toolsRaw.exclude !== undefined && toolsRaw.remove === undefined) {
			warnings.push("`tools.exclude` is deprecated; use `tools.remove`");
			toolsRaw.remove = toolsRaw.exclude;
		}
	}
	if (data.next !== undefined && data.handoff === undefined) {
		warnings.push("`next` is deprecated; use `handoff`");
		data = { ...data, handoff: data.next };
	}
	if (data.permissions === undefined) {
		if (data.grants !== undefined) {
			warnings.push("`grants` is deprecated; use `permissions`");
			data = { ...data, permissions: data.grants };
		} else if (data.autonomy !== undefined) {
			warnings.push("`autonomy` is deprecated; use `permissions`");
			data = { ...data, permissions: data.autonomy };
		}
	}
	if (isRecord(data.output) && data.output.validate !== undefined) {
		warnings.push("`output.validate` is ignored; validation belongs to the output-template plugin");
	}

	const chain: ChainDef = {
		name,
		version: typeof data.version === "number" ? data.version : 1,
		description: typeof data.description === "string" ? data.description : "",
		when: asWhen(data.when),
		thinking: asThinking(data.thinking),
		model: asModel(data.model),
		skills: asArray(data.skills),
		tools: toolsRaw ? asTools(toolsRaw) : undefined,
		output: asOutput(data.output),
		permissions: asPermissions(data.permissions),
		phases: asPhases(data.phases, warnings),
		handoff: asHandoff(data.handoff, warnings),
		extends: asArray(data.extends),
		body: body.trim(),
		sourcePath,
	};
	return { chain, warnings };
}

function unionStrings(a?: string[], b?: string[]): string[] | undefined {
	const set = new Set([...(a ?? []), ...(b ?? [])]);
	return set.size ? [...set] : undefined;
}

function mergeHandoff(base?: ChainHandoff[], overlay?: ChainHandoff[]): ChainHandoff[] | undefined {
	if (!base && !overlay) return undefined;
	const map = new Map<string, ChainHandoff>();
	for (const item of base ?? []) map.set(item.chain, item);
	for (const item of overlay ?? []) map.set(item.chain, item);
	return [...map.values()];
}

function mergeTools(base?: ChainTools, overlay?: ChainTools): ChainTools | undefined {
	if (!base && !overlay) return undefined;
	return {
		base: overlay?.base ?? base?.base,
		add: unionStrings(base?.add, overlay?.add),
		remove: unionStrings(base?.remove, overlay?.remove),
	};
}

function mergeWhen(base?: ChainWhen, overlay?: ChainWhen): ChainWhen | undefined {
	if (!base && !overlay) return undefined;
	const when: ChainWhen = {
		keywords: unionStrings(base?.keywords, overlay?.keywords),
		fileGlobs: unionStrings(base?.fileGlobs, overlay?.fileGlobs),
		taskTypes: unionStrings(base?.taskTypes, overlay?.taskTypes),
		always: overlay?.always ?? base?.always,
	};
	return when.keywords || when.fileGlobs || when.taskTypes || when.always !== undefined ? when : undefined;
}

/** Deterministic merge: `overlay` (child) wins on scalars, arrays are unioned. */
export function mergeChains(base: ChainDef, overlay: ChainDef): ChainDef {
	return {
		name: overlay.name,
		version: Math.max(base.version, overlay.version),
		description: overlay.description || base.description,
		when: mergeWhen(base.when, overlay.when),
		thinking: overlay.thinking ?? base.thinking,
		model: { ...base.model, ...overlay.model },
		skills: unionStrings(base.skills, overlay.skills),
		tools: mergeTools(base.tools, overlay.tools),
		output: {
			template: overlay.output?.template ?? base.output?.template,
			hint: overlay.output?.hint ?? base.output?.hint,
		},
		permissions: { ...base.permissions, ...overlay.permissions },
		phases: overlay.phases ?? base.phases,
		handoff: mergeHandoff(base.handoff, overlay.handoff),
		extends: overlay.extends,
		body: [base.body, overlay.body].filter((s) => s.trim().length > 0).join("\n\n"),
		sourcePath: overlay.sourcePath,
	};
}

export function resolveChain(name: string, chains: Map<string, ChainDef>, seen: Set<string> = new Set()): ChainDef | undefined {
	const chain = chains.get(name);
	if (!chain) return undefined;
	if (!chain.extends || chain.extends.length === 0) return chain;
	if (seen.has(name)) return chain; // cycle: stop merging
	const nextSeen = new Set(seen);
	nextSeen.add(name);
	let merged: ChainDef | undefined;
	for (const baseName of chain.extends) {
		const base = resolveChain(baseName, chains, nextSeen);
		if (!base) continue;
		merged = merged ? mergeChains(merged, base) : base;
	}
	return merged ? mergeChains(merged, chain) : chain;
}

export function resolveAll(chains: Map<string, ChainDef>): Map<string, ChainDef> {
	const out = new Map<string, ChainDef>();
	for (const name of chains.keys()) {
		const resolved = resolveChain(name, chains);
		if (resolved) out.set(name, resolved);
	}
	return out;
}

function listChainFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => /\.(md|json)$/i.test(name) && !name.startsWith("."))
		.map((name) => path.join(dir, name))
		.sort();
}

function parseChainFile(file: string): NormalizeResult {
	const raw = fs.readFileSync(file, "utf-8");
	const base = path.basename(file).replace(/\.(md|json)$/i, "");
	const fallbackName = base === "template" ? path.basename(path.dirname(file)) : base;
	if (file.toLowerCase().endsWith(".json")) {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const body = typeof parsed.body === "string" ? parsed.body : "";
		return normalizeChain(parsed, body, file, fallbackName);
	}
	const { data, body } = parseFrontmatter(raw);
	return normalizeChain(data, body, file, fallbackName);
}

/** Load chains: builtin < user < project < extra dirs. Later wins on name collision. */
export function loadChains(cwd: string, extraDirs: string[] = []): ChainLoadResult {
	const chains = new Map<string, ChainDef>();
	const warnings: string[] = [];
	const sources: string[] = [];
	for (const dir of [BUILTIN_DIR, chainsDir(), projectChainsDir(cwd), ...extraDirs]) {
		sources.push(dir);
		for (const file of listChainFiles(dir)) {
			try {
				const result = parseChainFile(file);
				for (const w of result.warnings) warnings.push(`${file}: ${w}`);
				if (!result.chain) {
					warnings.push(`skipped ${file}: no chain name`);
					continue;
				}
				if (chains.has(result.chain.name)) {
					warnings.push(`chain "${result.chain.name}" overridden by ${file}`);
				}
				chains.set(result.chain.name, result.chain);
			} catch (err) {
				warnings.push(`failed to parse ${file}: ${(err as Error).message}`);
			}
		}
	}
	return { chains, warnings, sources };
}
