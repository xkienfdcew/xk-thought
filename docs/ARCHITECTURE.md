# Architecture

`xk-thought` is a **standalone** pi plugin. It owns the "reasoning protocol" concern and
imports nothing from the task or output-template plugins.

```
extensions/thought-chain/
  index.ts        pi wiring: lifecycle, routing, prompt injection, tool/thinking application
  types.ts        ChainDef / PhaseDef / Permissions / Handoff / State / Config
  config.ts       own config (~/.pi/agent/thought-chain/config.json + project override)
  registry.ts     discovery + normalize (legacy aliases) + extends merge
  state.ts        phase machine (pure)
  router.ts       keywords / fileGlobs / always selection (pure)
  runtime.ts      computeTools + permission enforcement + prompt assembly (pure)
  tools.ts        `chain` tool
  commands.ts     /chain, /phase
  events.ts       event name constants
  lib/            paths, yaml subset, frontmatter, glob/extractPaths, args (zero-dep)
chains/builtin/   react, plan-execute, debug, research, review
scripts/          selftest.mjs (pure), verify-rpc.mjs (real pi)
```

## Lifecycle

```
session_start
  -> loadConfig + loadChains + resolveAll(extends)
  -> restore thought-chain/state from session entries
  -> if restored chain exists: apply (thinking + tools)
     else selectDefault: config.default > unique when.always > none

input                 (routing.auto && no active chain && not a /command)
  -> route(): keywords + fileGlobs(input paths ∪ touched files); ambiguity -> no switch
  -> activate()

tool_call             (read/edit/write)
  -> remember touched file (LRU, 64)

before_agent_start
  -> buildPrompt(): body + phase + skills + output hint + permission denials + handoff suggestion
  -> return { systemPrompt: existing + block }

chain tool / /chain / /phase
  -> activate / advance / goto / reset / off / reload
  -> pi.setThinkingLevel, pi.setActiveTools(computeTools)
  -> pi.appendEntry("thought-chain/state", ...) + pi.events.emit(...)

session_shutdown
  -> restore pre-chain tool snapshot (if tools.isolate), clear in-memory state
```

## Tool computation

```
base = chain.tools.base ?? snapshot
 + chain.tools.add      - chain.tools.remove
 + phase.tools.add      - phase.tools.remove
 - permission removals (network:false | write:false | shell:false)
 + CORE_TOOLS ("chain")   # always kept so the model can inspect/advance
```

A phase can re-add a tool the chain removed (e.g. debug removes `edit`/`write`, the `fix`
phase re-adds them).

## Cross-plugin contracts

- **Events** (`pi.events`): `thought-chain/{loaded,activated,phase,completed,deactivated}`.
- **Session entry** `thought-chain/state`: durable snapshot of the active chain incl. `output`
  and `permissions`, readable by any extension.

The plugin never imports other plugins and never grants permissions itself: `permissions` are
declared and exposed; host policy decides.
