# xk-thought

> **给 [pi](https://pi.dev) 加上可切换的「思维链」——把"该怎么想"变成一份可复用、可继承、可约束的声明文件。**
> 独立插件 · 零运行时依赖 · 不改 pi 内核 · 不调用任何外部服务

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![pi-package](https://img.shields.io/badge/pi--package-yes-ff6b9d.svg)](https://github.com/topics/pi-package)
[![tests](https://img.shields.io/badge/tests-13%20unit%20%2B%2010%20rpc-brightgreen.svg)](./scripts)

> 仓库：`xkienfdcew/xk-thought`　包名：`xk-thought`

---

## 30 秒看懂

pi 很擅长"给模型几个工具让它干活"，但缺一层**推理协议**：

| 已有的东西 | 管什么 | 不管什么 |
|---|---|---|
| Skill | **会不会做**（能力包） | 按什么步骤想 |
| `AGENTS.md` / `SYSTEM.md` | 全局静态提示 | 不同任务用不同范式 |
| Prompt Template | 一次性展开 | 跨会话约束过程 |
| 多 agent | 上下文隔离 | 单个 agent 内的范式切换 |

**思维链 = 一次任务该用哪种方式思考**：一个 Markdown 文件同时声明 8 个维度——

```
提示词 · 技能 · 工具集 · 思考等级 · 模型偏好 · 阶段机 · 输出契约(软) · 权限声明
```

pi 在运行时会把它翻译成真实行为：注入系统提示、切换工具集与思考等级、推进阶段、并把「权限声明」和「交接建议」广播给宿主。

```
用户输入
   │
   ├─ 路由           keywords / fileGlobs / always  ──►  选中一条链
   ├─ 注入系统提示    链正文 + 当前阶段 + 推荐技能 + 输出契约 + 权限约束
   ├─ 应用工具集      base ± add/remove，再按 permissions 裁剪
   ├─ 应用思考等级    off … max
   │
   ├─ 模型工作  ──►  chain(use / phase / info) 自选与推进
   └─ 走到末尾  ──►  thought-chain/completed { handoff }   （只建议，绝不自动切）
```

---

## 安装

```bash
# 从 git
pi install git:github.com/xkienfdcew/xk-thought

# 从本地目录
pi install /absolute/path/to/xk-thought

# 开发期直接加载
pi -e ./extensions/thought-chain/index.ts
```

---

## 快速开始

```text
/chain list          # 查看可用链，* 标记当前
/chain use debug     # 激活 debug：reproduce → locate → fix → verify
/phase next          # 推进阶段
/phase goto verify   # 跳到指定阶段
/chain info debug    # 看阶段、工具增量、权限声明、输出契约
/chain off           # 关闭，恢复进入前的工具集
/chain reload        # 改完链文件立即生效
```

**模型侧不需要你教它**：系统提示里已注入当前链与阶段，`chain` 工具自带使用指引，模型会在任务类型明显变化时自己换链、在阶段完成时自己推进。

---

## 一条链长什么样

放到 `~/.pi/agent/chains/<name>.md`（全局）或 `<project>/.pi/chains/<name>.md`（项目，需信任），同名覆盖内置。

```md
---
name: debug
description: 系统化定位并修复缺陷：先复现、再定位、后修复、必验证。
when:
  keywords: [bug, 报错, 崩溃, 复现, stack trace]
  fileGlobs: ["**/*.log"]
thinking: high
tools:
  add: [grep, find]
  remove: [edit, write]        # 修复前不允许写
output:
  template: bug-report
permissions:
  write: true                  # 后面 fix 阶段会重新放开
  shell: true
  network: false
  unattended: false
  sideEffects: false
phases:
  - id: reproduce
    prompt: 先写出最小可复现步骤；未经复现不要猜根因。
    exit: 已得到稳定复现
  - id: locate
    prompt: 用二分/日志/断点定位根因，区分观察与推断。
    exit: 根因明确且有证据
  - id: fix
    prompt: 做最小必要修改；说明为何这样改与影响面。
    tools: { add: [edit, write] }   # 阶段可以重新放开
    exit: 修复完成
  - id: verify
    prompt: 重新运行复现与测试验证；失败则回到 locate。
    exit: 验证通过
handoff:
  - chain: review
---
# Debug 思维链
你是一名严谨的调试专家。始终区分「观察」与「推断」……
```

正文就是常驻提示词；frontmatter 是协议。**注意 `fix` 阶段重新放开了链级移除的 `edit/write`**——阶段工具是增量的。

### 内置链

| 链 | 适用 | 思考等级 | 阶段 |
|----|------|---------|------|
| `react` | 通用工具调用（默认） | medium | 单阶段 |
| `plan-execute` | 多步长任务 | high | plan → execute → verify |
| `debug` | 缺陷定位修复 | high | reproduce → locate → fix → verify |
| `research` | 资料调研 | medium | question → collect → synthesize |
| `review` | 代码审查（只读） | high | inspect → analyze → report |

---

## 核心能力

### 1. 三类触发 + 可控的自主选择

`when` 借鉴 OpenHands microagents 的 always/keyword/path：

| 触发 | 匹配对象 |
|---|---|
| `keywords[]` | 用户输入文本 |
| `fileGlobs[]` | 输入里出现的路径 + 本会话 `read/edit/write` 触碰过的文件（LRU 64） |
| `always: true` | 无激活链时的默认链 |

优先级：`config.default` > 唯一 `always` > `keywords/fileGlobs`（唯一命中且达阈值）> 不激活。

两条刻意的保守设计：**规则路由默认关闭**且只在"当前没有激活链"时生效；**已激活链时永不自动覆盖**——用户或模型的显式选择永远优先。歧义（并列命中）时不切换，交给模型自选。

### 2. 权限是"声明 + 部分强制"

链声明它**需要**什么，而不是"我拥有什么"：

| 字段 | 本插件可强制？ | 行为 |
|---|---|---|
| `network` / `write` / `shell` | ✅ | 声明 `false` 就**移除**对应工具（web / edit+write / bash+powershell）；声明 `true` **不会主动加工具**（防止隐式提权） |
| `unattended` / `sideEffects` / `subagents` / `maxSubagents` / `approval` / `budget` | ❌ 只声明 | 写入事件与会话条目，由任务/agent 插件的策略层裁决 |

模型提示里只注入**禁止性**声明（如"不得产生外部副作用"）。宿主必须结合**真实生效后的工具面**交叉判断，不能只信链的自报。

### 3. 阶段是手动的，不是 FSM

阶段只能由模型（`chain phase`）或用户（`/phase`）推进，插件**不引入 transitions/guards/自动跃迁**。`phases.enforceExit=true` 时，未声明 `exit` 的阶段会被拒绝推进。阶段状态写入会话条目，`/resume` 后自动恢复。

### 4. handoff 只建议，不执行

`handoff` 声明"完成后建议用哪条链"，支持 `{ chain, when?, inputs? }`。链走到最后阶段时：

- 广播 `thought-chain/completed { name, handoff }`
- 在提示里建议下一步
- **不会**自动切链或自动开子 agent——是否交接由用户或宿主插件决定

这样"链"永远不会变成隐式的编排器。

### 5. 与其它插件只通过两条通道协作

本插件 **不 import** 任何其它插件。

**事件（`pi.events`）**

| 事件 | 载荷 |
|---|---|
| `thought-chain/loaded` | `{ count, warnings[] }` |
| `thought-chain/activated` | `{ name, phase, output?, permissions?, reason }` |
| `thought-chain/phase` | `{ name, from, to, phaseId }` |
| `thought-chain/completed` | `{ name, handoff[] }` |
| `thought-chain/deactivated` | `{}` |

**会话条目 `thought-chain/state`**：`{ chain, phase, phaseId, output, permissions, since, updatedAt }`，随会话保存/恢复。

> 例：输出模板插件订阅 `activated`（或读 state entry）自行注入 schema 并校验；任务插件读 `permissions` 决定是否放行无人值守。

---

## 配置

`~/.pi/agent/thought-chain/config.json`（项目覆盖 `<cwd>/.pi/thought-chain.json`）：

```jsonc
{
  "enabled": true,
  "default": "react",             // 新会话默认链；null = 不自动激活（此时用 when.always）
  "dirs": [],                     // 额外链目录（优先级最高）
  "routing": { "auto": false, "threshold": 0.6 },
  "tools": { "isolate": true },   // 关闭时恢复切链前的工具集
  "phases": { "enforceExit": false },
  "handoff": { "suggest": true }
}
```

环境变量 `PI_THOUGHT_CHAIN=0` 全局禁用。

---

## 验证

```bash
node scripts/selftest.mjs     # 13 项纯逻辑单测（无需 pi）
node scripts/verify-rpc.mjs   # 10 项真实 pi RPC 端到端（不调用模型）
```

`verify-rpc` 会在隔离的 agent 目录里启动真实 `pi --mode rpc`，验证：命令注册、`when.always` 默认激活、链切换、阶段下一/跳转/重置、关闭、reload，以及无 `extension_error`。

---

## 设计取舍（明确的非目标）

| 不做 | 原因 |
|---|---|
| 显式状态机（FSM） | 与"模型自主决策"定位冲突，声明复杂度陡增 |
| 运行时链叠加（overlay / mixin） | 提示词/工具/阶段三重冲突，反复失效 prompt cache；组合用加载期 `extends` |
| 代码化链（TS 模块） | 不可分享、有安全面、与 pi 扩展机制重叠 |
| 输出校验与渲染 | 归输出模板插件；本插件只做"软提示" |
| 任务调度与通知 | 归任务插件 |
| 权限授予与预算熔断 | 归宿主策略，链只能声明 |

---

## 已知限制

- `tui` / `rpc` / `json` / `print` 均可加载；斜杠命令的交互入口仅在 tui/rpc。
- 扩展由 pi 的 jiti 加载；验证脚本需要 Node ≥ 22.18。
- 旧字段别名（`triggers`→`when`、`tools.extra`→`add`、`tools.exclude`→`remove`、`next`→`handoff`、`autonomy`/`grants`→`permissions`）仍可读，会记 warning。

---

## 相关

本插件是从三合一项目 `pi-autonomy` 中拆出的**思维链**模块。另外两个模块将拆为独立插件：

- `pi-task-runner`：任务模型、调度、执行器、通知、提案
- `pi-output-template`：模板、schema 校验、7 格式渲染、投递

三者零共享代码、零互相 import，可单独安装。

---

## 许可

[MIT](./LICENSE)
