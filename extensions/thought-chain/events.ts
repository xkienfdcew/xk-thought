/** Event names emitted on pi's shared event bus (pi.events). */

export const EVENTS = {
	loaded: "thought-chain/loaded",
	activated: "thought-chain/activated",
	phase: "thought-chain/phase",
	completed: "thought-chain/completed",
	deactivated: "thought-chain/deactivated",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
