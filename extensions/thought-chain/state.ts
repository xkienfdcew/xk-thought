/** Phase machine + session-state helpers. Pure; no pi imports. */

import type { ChainDef, ChainState, PhaseDef } from "./types.ts";

export function initialState(): ChainState {
	return { phase: 0, since: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function clampPhase(chain: ChainDef | undefined, index: number): number {
	if (!chain?.phases || chain.phases.length === 0) return 0;
	return Math.max(0, Math.min(index, chain.phases.length - 1));
}

export function phaseOf(chain: ChainDef | undefined, state: ChainState): PhaseDef | undefined {
	if (!chain?.phases || chain.phases.length === 0) return undefined;
	return chain.phases[clampPhase(chain, state.phase)];
}

export function isLastPhase(chain: ChainDef | undefined, state: ChainState): boolean {
	if (!chain?.phases || chain.phases.length === 0) return false;
	return clampPhase(chain, state.phase) === chain.phases.length - 1;
}

export function advancePhase(chain: ChainDef | undefined, state: ChainState, delta = 1): ChainState {
	const next = clampPhase(chain, state.phase + delta);
	return { ...state, phase: next, phaseId: chain?.phases?.[next]?.id, since: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function gotoPhase(chain: ChainDef | undefined, state: ChainState, target: string | number): ChainState | undefined {
	if (!chain?.phases || chain.phases.length === 0) return undefined;
	let index: number;
	if (typeof target === "number") {
		index = target;
	} else {
		index = chain.phases.findIndex((p) => p.id === target);
		if (index < 0) return undefined;
	}
	const next = clampPhase(chain, index);
	return { ...state, phase: next, phaseId: chain.phases[next]?.id, since: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export interface PhaseProgress {
	index: number;
	total: number;
	id: string;
	label: string;
}

export function phaseProgress(chain: ChainDef | undefined, state: ChainState): PhaseProgress | undefined {
	if (!chain?.phases || chain.phases.length === 0) return undefined;
	const index = clampPhase(chain, state.phase);
	return { index, total: chain.phases.length, id: chain.phases[index].id, label: `${index + 1}/${chain.phases.length} ${chain.phases[index].id}` };
}
