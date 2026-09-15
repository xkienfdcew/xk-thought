# Changelog

## 0.2.0

- Renamed the package to `xk-thought` (repository `xkienfdcew/xk-thought`);
  the checkout folder is now `D:\DevTools\xk-thought`. No behavior changes.

## 0.1.0

Initial standalone release (extracted from the 3-in-1 `pi-autonomy`).

- Chain registry: discovery (`builtin < ~/.pi/agent/chains < <cwd>/.pi/chains < config.dirs`),
  YAML-subset frontmatter parsing (incl. inline maps), legacy aliases, deterministic `extends` merge.
- Phase machine: manual advance / goto / reset, optional `enforceExit`.
- Routing: `when.keywords` / `when.fileGlobs` (input paths + touched files) / `when.always`,
  with `config.default` precedence, ambiguity guard, and default-off `routing.auto`.
- Permissions: `network` / `write` / `shell` enforced by tool removal; `unattended` /
  `sideEffects` / `subagents` / `maxSubagents` / `approval` / `budget` declared for host policy.
- Handoff: string or `{ chain, when?, inputs? }`; never auto-executed; `thought-chain/completed` event.
- Tools/commands: `chain` tool, `/chain`, `/phase`.
- Events: loaded / activated / phase / completed / deactivated; state in `thought-chain/state` session entry.
- 5 builtin chains: react, plan-execute, debug, research, review.
- Verification: 13 pure unit tests + 10 real-pi RPC checks.
