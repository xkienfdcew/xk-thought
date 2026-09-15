/** Thought-chain domain model. Pure types; no pi imports. */

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ChainWhen {
	/** Match against the user's input text (case-insensitive substring). */
	keywords?: string[];
	/** Match against paths mentioned in input or files touched this session. */
	fileGlobs?: string[];
	/** Fallback chain when no chain is active (config.default wins). */
	always?: boolean;
	/** Optional task types supplied by a task plugin via events. */
	taskTypes?: string[];
}

export interface ChainTools {
	base?: string[];
	add?: string[];
	remove?: string[];
}

export interface ChainOutput {
	template?: string;
	hint?: string;
}

export interface ChainPermissions {
	unattended?: boolean;
	sideEffects?: boolean;
	subagents?: boolean;
	maxSubagents?: number;
	approval?: "none" | "on-write" | "always";
	network?: boolean;
	write?: boolean;
	shell?: boolean;
	budget?: { maxTokens?: number; maxWallClockMs?: number };
}

export interface ChainHandoff {
	chain: string;
	when?: string;
	inputs?: Record<string, string>;
}

export interface PhaseDef {
	id: string;
	prompt: string;
	enter?: string;
	exit?: string;
	tools?: ChainTools;
	output?: ChainOutput;
}

export interface ChainModelPref {
	prefer?: string[];
	avoid?: string[];
	kind?: "reasoning" | "fast";
}

export interface ChainDef {
	name: string;
	version: number;
	description: string;
	when?: ChainWhen;
	thinking?: ThinkingLevel;
	model?: ChainModelPref;
	skills?: string[];
	tools?: ChainTools;
	output?: ChainOutput;
	permissions?: ChainPermissions;
	phases?: PhaseDef[];
	handoff?: ChainHandoff[];
	extends?: string[];
	body: string;
	sourcePath: string;
}

export interface ChainState {
	chain?: string;
	phase: number;
	phaseId?: string;
	output?: ChainOutput;
	permissions?: ChainPermissions;
	since: string;
	updatedAt: string;
}

export interface ThoughtChainConfig {
	enabled: boolean;
	/** Default chain for new sessions. `null` disables default activation. */
	default: string | null;
	/** Extra chain directories (highest precedence). */
	dirs: string[];
	routing: {
		auto: boolean;
		threshold: number;
	};
	tools: {
		/** Restore the pre-chain tool snapshot on deactivate. */
		isolate: boolean;
	};
	phases: {
		/** Reject advancing a phase that declares no `exit` condition. */
		enforceExit: boolean;
	};
	handoff: {
		/** Suggest handoff chains when the last phase is reached. */
		suggest: boolean;
	};
}

export interface ChainLoadResult {
	chains: Map<string, ChainDef>;
	warnings: string[];
	sources: string[];
}
