# pi-thought-chain

> 给 [pi](https://pi.dev) 加上**可切换的推理协议（思维链）**：一个 Markdown 文件声明「提示词 + 技能 + 工具集 + 思考等级 + 阶段 + 权限」。
> 独立插件、零运行时依赖、不改 pi 内核。

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![pi-package](https://img.shields.io/badge/pi--package-yes-ff6b9d.svg)](https://github.com/topics/pi-package)

pi 很擅长"给模型几个工具让它干活"，但缺一层**推理协议**：skill 管"会不会做"，AGENTS.md 管全局静态提示，都不管"按什么步骤想、能用哪些工具、什么时候该换范式"。本插件把这件事变成**一等资源**：可读、可 diff、可继承、可切换。

---

## 安装

```bash
# 从 git
pi install git:github.com/<user>/pi-thought-chain

# 从本地目录
pi install /absolute/path/to/pi-thought-chain

# 开发期直接加载
pi -e ./extensions/thought-chain/index.ts
```

安装后 pi 会自动加载 `extensions/thought-chain/index.ts`，`pi config` 可启用/禁用。

---

## 快速开始

```text
/chain list          # 查看可用链，* 标记当前
/chain use debug     # 激活 debug：reproduce → locate → fix → verify
/phase next          # 手动推进阶段
/phase goto verify   # 跳到指定阶段
/phase reset         # 回到第一阶段
/chain info debug    # 查看阶段、工具、权限声明、输出契约
/chain off           # 关闭，恢复进入前的工具集
/chain reload        # 重新扫描链文件（改完立即生效）
```

模型侧无需你教它：系统提示里已注入当前链与阶段，`chain` 工具自带使用指引（`promptGuidelines`）。

---

## 链定义

放在 `~/.pi/agent/chains/`（全局）或 `<project>/.pi/chains/`（项目，需信任），同名覆盖内置。一个链 = YAML frontmatter + Markdown 正文（正文即常驻提示词）。

```md
---
name: debug
version: 1
description: 系统化定位并修复缺陷：先复现、再定位、后修复、必验证。
when:
  keywords: [bug, 报错, 崩溃, 复现, stack trace]
  fileGlobs: ["**/*.log", "src/**/*.ts"]
  always: false
thinking: high
model: { kind: reasoning }
skills: [systematic-debugging]
tools:
  add: [grep, find]
  remove: [edit, write]
output:
  template: bug-report
  hint: 必须包含 复现/根因/修复/验证 四段
permissions:
  write: true
  shell: true
  network: false
  unattended: false
  sideEffects: false
  approval: on-write
phases:
  - id: reproduce
    enter: always
    prompt: 先写出最小可复现步骤；未经复现不要猜根因。
    exit: 已得到稳定复现
  - id: locate
    prompt: 用二分/日志/断点定位根因，区分观察与推断。
    exit: 根因明确且有证据
  - id: fix
    prompt: 做最小必要修改；说明为何这样改与影响面。
    tools: { add: [edit, write] }
    exit: 修复完成
  - id: verify
    prompt: 重新运行复现与测试验证；失败则回到 locate。
    exit: 验证通过
handoff:
  - chain: review
    inputs: { report: bug-report }
---
# Debug 思维链
你是一名严谨的调试专家。始终区分「观察」与「推断」……
```

### 字段

| 字段 | 类型 | 语义 |
|---|---|---|
| `name` / `version` / `description` | string / number / string | 链名（唯一键，缺省用文件名）/ 合并时取较大值 / 供列表与路由理解 |
| `when` | object | 路由触发：`keywords[]`（文本命中）/ `fileGlobs[]`（路径命中）/ `always`（默认链）/ `taskTypes[]`（可选，需外部提供） |
| `thinking` | enum | `off…max` |
| `model` | object | `prefer[]` / `avoid[]` / `kind: reasoning\|fast`（仅建议，不自动换模型） |
| `skills` | string[] | 推荐技能（注入提示，不强制加载） |
| `tools` | object | `base[]`（整体替换）/ `add[]` / `remove[]` |
| `output` | object | `template` / `hint`（**软提示**，校验归输出模板插件） |
| `permissions` | object | 权限声明，见下 |
| `phases` | Phase[] | 缺省为单阶段 |
| `handoff` | string[] \| object[] | 完成后的**建议**交接（不自动执行），见下 |
| `extends` | string[] | 定义期继承（后加载者覆盖，数组取并集） |
| 正文 | markdown | 常驻提示词 |

### 权限声明 `permissions`

链声明它**需要**什么，而不是"我拥有什么"。

| 字段 | 本插件可强制？ | 语义 |
|---|---|---|
| `network` / `write` / `shell` | ✅ | 声明 `false` 时**移除**对应工具（web / edit+write / bash+powershell）；声明 `true` **不会主动加工具** |
| `unattended` | ❌ 只声明 | 是否请求无人值守执行 |
| `sideEffects` | ❌ 只声明 | 是否会产生外部副作用（推送/发信/发布/外部写） |
| `subagents` / `maxSubagents` | ❌ 只声明 | 是否请求派生子 agent / 并发上限 |
| `approval` | ❌ 只声明 | 请求的审批级别：`none` / `on-write` / `always` |
| `budget` | ❌ 只声明 | 请求的预算上限（`maxTokens` / `maxWallClockMs`） |

声明通过 `thought-chain/activated` 事件与会话条目暴露给宿主（任务/agent 插件）策略层；宿主必须结合**真实生效后的工具面**交叉判断，不能只信链的自报。模型提示里只注入**禁止性**声明（如"不得产生外部副作用"）。

### 阶段

阶段**只能手动推进**（模型 `chain phase` 或用户 `/phase`），本插件**不实现 FSM**。`phases.enforceExit=true` 时，未声明 `exit` 的阶段会被拒绝推进。

### handoff（交接）

`handoff` 是"完成后建议用哪条链"的**声明**，本插件**不会**自动切换。链走到最后阶段时广播 `thought-chain/completed { name, handoff }` 并在提示里建议；是否交接由**用户或宿主插件**决定。对象形式可带 `inputs` 声明交接所需产物（供宿主校验/填充）。

### 内置链

`react`（默认）· `plan-execute` · `debug` · `research` · `review`

---

## 路由

`when` 三类触发的选择优先级（仅当**当前无激活链**且 `routing.auto=true`）：

1. `config.default`（用户显式配置）
2. 唯一的 `when.always` 链（多条告警，按名称字典序取一）
3. `keywords` / `fileGlobs` 唯一命中且达 `routing.threshold`
4. 不激活

`fileGlobs` 匹配"用户输入里出现的路径"与"本会话 `read/edit/write` 触碰过的文件"（LRU，上限 64）；**不在 `tool_call` 当下切链**（避免回合中途改系统提示），只在下一个 `input` 判定。已激活链时**不自动覆盖**，用户/模型显式选择优先。

---

## 配置

`~/.pi/agent/thought-chain/config.json`（项目覆盖 `<cwd>/.pi/thought-chain.json`）：

```jsonc
{
  "enabled": true,
  "default": "react",             // 新会话默认链；null = 不自动激活（此时用 when.always）
  "dirs": [],                     // 额外链目录
  "routing": { "auto": false, "threshold": 0.6 },
  "tools": { "isolate": true },   // 切链时隔离并恢复工具集
  "phases": { "enforceExit": false },
  "handoff": { "suggest": true }
}
```

环境变量 `PI_THOUGHT_CHAIN=0` 全局禁用。

---

## 对外接口（与其他插件协作）

本插件**不 import** 任务/模板插件，只通过两条通道协作：

**事件（`pi.events`）**

| 事件 | 载荷 |
|---|---|
| `thought-chain/loaded` | `{ count, warnings[] }` |
| `thought-chain/activated` | `{ name, phase, output?, permissions?, reason }` |
| `thought-chain/phase` | `{ name, from, to, phaseId }` |
| `thought-chain/completed` | `{ name, handoff[] }` |
| `thought-chain/deactivated` | `{}` |

**会话条目** `thought-chain/state`：`{ chain, phase, phaseId, output, permissions, since, updatedAt }`，随会话保存/恢复，其他插件与桌面端可直接读取。

> 例：输出模板插件订阅 `activated` 或读 state entry，自行注入 schema 并校验；任务插件读 `permissions` 决定是否放行无人值守。

---

## 验证与开发

```bash
node scripts/selftest.mjs     # 13 项纯逻辑单测（无需 pi）
node scripts/verify-rpc.mjs   # 真实 pi RPC 端到端（10 项，不调用模型）
```

`verify-rpc` 会启动隔离 agent 目录的真实 `pi --mode rpc`，验证命令注册、`when.always` 默认激活、链切换、阶段推进/跳转/重置、关闭、reload，以及无 `extension_error`。

---

## 兼容性与已知限制

- **模式**：`tui` / `rpc` / `json` / `print` 均可加载；命令交互入口仅在 tui/rpc。
- **Node**：扩展由 pi 的 jiti 加载；脚本需要 Node ≥ 22.18。
- **不做**：FSM / 运行时叠加（overlay/mixin）/ 代码化链 / 输出校验（归输出模板插件）/ 任务调度（归任务插件）。
- **别名兼容**：`triggers`→`when`、`tools.extra`→`add`、`tools.exclude`→`remove`、`next`→`handoff`、`autonomy`/`grants`→`permissions` 仍可读，会记 warning。

---

## 许可

[MIT](./LICENSE)
