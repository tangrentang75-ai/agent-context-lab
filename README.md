# 任务罗盘 · Agent Context Lab

**让 AI 做的事，对得上你真正想完成的事。**

任务罗盘是一个在自己电脑上运行的网页工具：先写清目标，再查看完成证据，最后比较投入。它帮助学生、开发者和项目团队回答三个问题：

> 我想做成什么？凭什么说已经做成？下一步还值得投入在哪里？

当前版本 **v0.25.10** · **MIT 许可证** · **Node.js 20+** · **无需安装 npm 依赖**

[快速开始](#快速开始) · [功能介绍](#功能介绍) · [第一次使用](start-here.md) · [参与贡献](CONTRIBUTING.md) · [English overview](#english-overview)

## 为什么做这个项目

AI 可以很快生成代码、整理资料或给出方案，但“输出很多”不一定意味着“任务完成”。有时它探索了大量无关内容；有时看似多余的检查，恰好避免了关键错误。只看回答长度、调用次数或 token 消耗，很难判断这些投入有没有价值。

任务罗盘从用户的目标出发，把每个目标与检查方法、实际记录和资源投入放在一起。**先确认结果是否符合要求，再讨论成本是否合理。**

例如，让 AI 修复活动报名系统，不能只检查“取消报名后名额增加”，还应检查重复请求是否产生重复记录、原有报名流程是否正常。即使某次执行更省 token，只要必需项没有通过，就不应被推荐。

项目起于软件工程专业的大创选题，目前是一套可运行的软件原型和研究工作台。研究方向是：怎样让目标、证据和资源投入之间的关系更清楚，并据此改进 AI 任务评估与资源分配。

## 适合谁

- **做课程设计或大创的学生**：把“功能做完了”拆成可检查的目标，准备能说明问题的材料。
- **使用 AI 编程或整理资料的开发者**：对照不同执行记录，查看遗漏、失败、未知成本及验收依据。
- **需要复核项目进展的团队**：保留每轮检查，说明已经确认的部分和下一步仍需验证的部分。

## 功能介绍

| 功能 | 可以做什么 | 入口 |
| --- | --- | --- |
| 任务概览 | 搜索任务、按场景筛选、查看当前记录的用量和验收分布 | 首页 |
| 策略比较 | 设置必需目标、权重和 token 预算；在同一条件组内比较执行记录 | 首页 → 策略比较 |
| 证据复核 | 查看执行时间线与逐项目标证据，人工修正验收状态 | 执行记录详情 |
| 保存与导出 | 保存整份任务数据，或导出当前任务的评估报告 | 首页工具栏 |
| 批量检查 | 不打开网页也能重评已有数据，保存预算、输入与规则校验值、逐条证据和结果 | [命令行使用说明](record-evaluation-guide.md) |
| 项目体检 | 无需编写 JSON 即可建立目标清单、追加检查轮次、比较差异、备份恢复 | `project-review.html` |
| 停止前核验 | 查看资料覆盖、原文片段和遗漏范围，帮助判断是否仍需补材料 | `review.html` |
| 资源决策 | 比较停止、候选提交和全文提交，保留预算与选择依据 | `decision.html` |
| 任务台账 | 关联决策、执行尝试、用量与人工验收，保留失败和未知项 | `ledger.html` |
| 实验中心 | 读取本机研究记录，查看上下文、检索、补读和质量反例实验 | 首页 → 实验中心 |

项目体检还提供观察计划和 CSV 检查工具，用于核对实际记录是否缺轮次、改条件或出现时间重叠。这些工具不会替代真实设备测试或参与者观察。

## 快速开始

准备 **Node.js 20 或以上版本**。如果使用 Git，可运行：

```bash
git clone https://github.com/tangrentang75-ai/agent-context-lab.git
cd agent-context-lab
npm start
```

也可以在仓库页面点击 **Code → Download ZIP**，解压后在项目目录运行 `npm start`。没有 npm 时，直接运行：

```bash
node server.cjs
```

然后在同一台电脑的浏览器中打开 **http://127.0.0.1:4173/**。使用期间保留终端；按 `Ctrl+C` 停止服务。Windows 用户也可双击 `start-local.cmd`，启动器会检查端口和项目版本。

**不需要执行 `npm install`。** 项目使用原生 HTML、CSS、JavaScript 和 Node.js 内置模块，没有前端构建步骤。普通演示、导入、复核和导出不需要 AI 账号或 API 密钥。

`127.0.0.1` 是本机地址，不是公开在线体验站。仓库公开后，其他人仍需下载并在自己的电脑启动。直接打开 `index.html` 可体验部分离线功能；完整本机接口需通过上述服务使用。

## 五分钟体验

1. 启动后查看人工构造的演示任务，选择“修复活动报名与名额恢复”。
2. 进入“策略比较”，查看不同执行记录的目标完成情况与 token 消耗。
3. 调整必需项、权重或预算，观察推荐结果为什么变化；这些操作只重评已有记录，不会重新调用 AI。
4. 打开“查看过程与验收证据”，检查某项判断是否有对应依据。
5. 点击“保存当前数据”下载 JSON；之后通过“导入记录”继续。若要检查自己的项目，进入“项目体检”，点击“开始新项目检查”。

完整操作说明见 [第一次使用任务罗盘](start-here.md) 和 [首页保存与恢复](homepage-data-guide.md)。

## 如何理解结果

目标得分按权重计算，但**高分不能抵消未通过的必需项**。证据缺失、验收未知或成本未知，都应单独保留。满足质量要求和预算后，平台才会在当前可比组内标记 token 最少的记录；并列时可同时标记。

- **更省 token ≠ 更省硬件算力或能源**，也不自动表示质量更高。
- **程序测试通过 ≠ 真实用户使用有效**，助手走查不属于真人试用。
- **引文匹配、文件校验值一致 ≠ 内容真实或推论成立**，仍需人工核对。
- **分组名称相同 ≠ 实验条件已独立验证一致**，导入者需说明模型、任务和环境。

这些边界直接影响比较结果，详见 [数据格式与评价口径](data-format.md)。

## 数据保存与隐私

| 数据 | 保存在哪里 | 使用提醒 |
| --- | --- | --- |
| 首页导入数据、目标和已提交复核 | 当前页面内存 | 刷新前用“保存当前数据”导出，整份导入/导出上限为 2MiB |
| 单任务评估报告 | 下载的 JSON 文件 | 用于复核结果，不能代替整份任务数据重新导入 |
| 项目检查存档、部分决策和台账 | 当前浏览器的本地存储 | 换浏览器或清理数据后可能丢失，定期导出备份 |
| 本机模型执行记录 | `runs/` | 由本机执行器生成，不随源码发布 |
| 私有案例资料 | `data/private/` 等本机目录 | 不随源码发布，新下载的项目没有原作者的私有案例 |

“本机没有附带案例”是正常提示，可直接新建项目。完整源码公开不代表原始用户材料公开。`.gitignore` 排除了执行记录、凭据配置和私有资料，但提交新文件前仍应自行检查内容。

服务默认只监听本机，使用文件白名单和接口来源检查。它没有多用户账户、权限系统或通用隔离执行环境，**不适合直接暴露到公网充当多人服务**。

## 可选：连接本机 AI

项目包含面向本机 Codex CLI 的实验适配器，不是任意模型 API 的通用客户端。离线使用无需配置；需要真实执行时，请先阅读 [真实接入说明](live-experiment.md) 和对应实验协议。

真实执行依赖本机已安装并登录的 Codex CLI，会消耗账号额度。适配器使用已有 CLI 登录，不要求在网页填写密钥。不要把密钥、登录文件或未经授权的代码放入仓库。

**`npm start` 和 `npm test` 不启动模型实验；部分 `npm run …` 研究命令会真实调用模型。** 不要批量执行所有 scripts。已有完成或停止的实验保留原协议与结果，不因安装项目而自动恢复。实验报告中的原始本机记录不全部随源码分发，仅下载仓库不能声称独立复现了历史实测。

## 技术结构

```text
浏览器页面：写目标 / 导入记录 / 人工复核 / 查看报告
        ↓
评估模块：必需项、证据状态、预算、可比条件组
        ↓
本地保存：下载 JSON、浏览器存储、Node.js 本机文件
        ↓（仅在明确启动真实执行时）
本机适配器：Codex CLI → 输出与用量回执 → 继续验收
```

| 文件或模块 | 作用 |
| --- | --- |
| `index.html`、`app.js`、`styles.css` | 首页、比较和实验工作台 |
| `evaluation.js` | 数据校验和任务评价规则 |
| `project-review*.js`、`project-review.html` | 项目体检、备份和轮次管理 |
| `review*.js`、`review.html` | 资料覆盖与停止前核验 |
| `resource-decision.js`、`decision-ui.js` | 资源决策与预算记录 |
| `task-ledger.js`、`task-executor.cjs` | 执行台账和本机执行适配 |
| `server.cjs`、`start-local.cjs` | 本地服务和启动检查 |
| `*.test.cjs` | Node.js 自动化测试 |

## 测试与当前进度

在项目目录运行：

```bash
npm test
```

测试使用 Node.js 自带的测试运行器，不调用真实模型。v0.25.9 于 **2026-10-20** 完成 **246 项测试通过**，并检查了分组切换和数据保存等浏览器流程，见 [软件检查记录](software-check-20261020.md)。这是指定版本的软件验证记录，不是持续集成徽章或模型准确率。

目前已具备可运行平台、受限执行链路、多轮项目复核和若干探索性实验。**尚未证明通用节省资源、提高准确率或改善真实用户体验；真人试用尚未开展。** 部分实验发现补读更贵、关键证据遗漏或停止条件误判，这些结果也保留在报告中。

尚未实现：账户与团队协作、后台数据库、任意仓库自动修复、通用模型接入、面向生产环境的在线资源调度。界面支持窄屏布局不等于已完成真实手机或老年用户验证。

下一阶段重点是独立用户试用、完善材料和错误提示，以及在固定模型与独立任务上验证研究假设；避免只增加功能而缺少验证。

v0.25.10 新增离线批量检查命令，不调用模型，沿用首页评价规则；2026-10-21 本机完整测试 **254 项通过、0 项失败**。开源参考来源、采纳理由与后续方向见 [开源学习与改进记录](open-source-learning.md)。

## 文档导航

| 想了解什么 | 文档 |
| --- | --- |
| 不懂术语也能开始 | [通俗使用说明](start-here.md) |
| 自己的项目如何建立检查清单 | [项目体检指南](project-review-guide.md) |
| 保存、导入和恢复首页记录 | [首页数据指南](homepage-data-guide.md) |
| 数据字段和评价方式 | [数据格式](data-format.md) |
| 停止、补读与预算决策 | [核验方法](review-method.md)、[资源决策](resource-allocation.md) |
| 检查现场观察记录 | [观察计划](observation-plan-guide.md)、[报告包复核](observation-check-guide.md) |
| 与导师讨论选题和进展 | [通俗进展说明](project-progress-20261015.md)、[研究方案](research-plan.md) |
| 软件范围和后续方向 | [产品计划](product-plan.md)、[试用草稿](usability-pilot-draft.md) |
| 查阅已有探索性实验 | [开发历史与报告索引](development-history.md) |

历史文档按当时版本保留；其中的实验执行命令不是新用户的默认操作步骤。当前使用方法以本页和对应功能指南为准。

## 参与贡献与许可证

欢迎通过 [Issues](https://github.com/tangrentang75-ai/agent-context-lab/issues) 提交问题，或通过 Pull Request 改进文档、交互、数据校验与测试。请附上可复现步骤，优先使用脱敏或虚构样本，并先阅读 [贡献指南](CONTRIBUTING.md)。

本仓库代码和原创文档采用 [MIT License](LICENSE)。外部论文、工具、引用材料和第三方服务仍适用各自的许可或条款；本许可不授予私有案例或参与者资料的使用权。

`package.json` 中的 `private: true` 只是防止误发布到 npm，与 GitHub 仓库是否公开无关。

## English overview

**Agent Context Lab (任务罗盘)** is a local web workspace for evaluating AI-assisted tasks against user-defined goals, acceptance evidence and resource budgets. It supports task comparison, manual evidence review, project checklists, versioned reviews, JSON backups, context coverage checks and an optional local Codex CLI adapter.

Run with **Node.js 20+**: clone the repository, run `npm start`, then open `http://127.0.0.1:4173/`. No npm dependencies or build step are required. `npm test` runs offline software tests. Real model execution is optional and consumes account quota; some research scripts invoke models directly, so read their protocols first.

This is a research prototype, not a production multi-user service. Demo records are synthetic. Missing evidence and unknown costs remain explicit. Lower token use does not establish better quality, lower hardware compute or general efficiency gains. Historical exploratory results have limitations, and independent participant studies have not yet been conducted. Source code and original documentation are available under the MIT license.
