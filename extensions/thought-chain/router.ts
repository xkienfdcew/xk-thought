/** Rule-based chain routing (keywords / fileGlobs / always). Pure; no pi imports. */

import type { ChainDef, ThoughtChainConfig } from "./types.ts";
import { extractPaths, globMatch } from "./lib/glob.ts";

export type RouteReason = "default" | "always" | "rule" | "ambiguous" | "no-match" | "none" | "missing";

export interface RouteResult {
	chain?: ChainDef;
	reason: RouteReason;
	detail?: string;
}

/** The single `when.always` chain, if exactly one exists. */
export function pickAlways(chains: ChainDef[]): { chain?: ChainDef; multiple: boolean } {
	const always = chains.filter((c) => c.when?.always === true).sort((a, b) => a.name.localeCompare(b.name));
	if (always.length === 0) return { multiple: false };
	return { chain: always[0], multiple: always.length > 1 };
}

/** Default activation at session start: config.default wins over when.always. */
export function selectDefault(config: ThoughtChainConfig, chains: ChainDef[]): RouteResult {
	if (config.default) {
		const chain = chains.find((c) => c.name === config.default);
		if (chain) return { chain, reason: "default" };
		return { reason: "missing", detail: `config.default="${config.default}" not found` };
	}
	const { chain, multiple } = pickAlways(chains);
	if (chain) return { chain, reason: "always", detail: multiple ? "multiple always chains; picked lexicographically" : undefined };
	return { reason: "none" };
}

/** Evaluate keywords/fileGlobs against the input text and the touched-files list. */
export function route(text: string, touchedFiles: string[], chains: ChainDef[], threshold: number): RouteResult {
	const lower = text.toLowerCase();
	const candidates = [...touchedFiles, ...extractPaths(text)];
	let best: ChainDef | undefined;
	let bestHits = 0;
	let ambiguous = false;
	const scores: Record<string, number> = {};
	for (const chain of chains) {
		const keywordHits = (chain.when?.keywords ?? []).filter((k) => k && lower.includes(k.toLowerCase())).length;
		const globHits = (chain.when?.fileGlobs ?? []).filter((g) => candidates.some((f) => globMatch(g, f))).length;
		const hits = keywordHits + globHits;
		if (hits > 0) scores[chain.name] = hits;
		if (hits > bestHits) {
			best = chain;
			bestHits = hits;
			ambiguous = false;
		} else if (hits > 0 && hits === bestHits && chain !== best) {
			ambiguous = true;
		}
	}
	const minHits = Math.max(1, Math.round(threshold * 2));
	if (ambiguous || !best || bestHits < minHits) {
		return { reason: ambiguous ? "ambiguous" : "no-match", detail: `${JSON.stringify(scores)}` };
	}
	return { chain: best, reason: "rule", detail: `${JSON.stringify(scores)}` };
}
