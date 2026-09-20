# 数据格式 v1 与评价口径

## 证据补读扩展（v0.5）

`source: local-evidence-study` 使用 `retrievalStudy` 存储预先固定的协议与原始汇总。每条策略运行包含 `calls`（每轮答案、资料 ID、usage、引文检查）、`retrieval.stopReason`、`retrieval.fallbacks` 和 `cost`。`tokens` 为所有调用的输入与输出之和；任一轮用量未知则为 null，已知部分保留在 `cost.knownTokens`。新增结果 `budget_stopped` 表示调用间阈值阻止后续调用，不能当作任务成功。`prematureStops` 是引文检查允许停止、但独立验收未通过的次数；不表示模型内部的置信度。资料数统计唯一文档，两轮重新发送的内容仍计入 token。

点击“下载示例”可获得完整 JSON，仓库也提供 `example.json`。

```json
{
  "version": 1,
  "demo": false,
  "tasks": [{
    "id": "task-1",
    "title": "任务名称",
    "description": "任务要求与输入范围",
    "scenario": "coding",
    "goals": [{"id":"g1","label":"独立测试通过","required":true,"weight":5}],
    "runs": [{
      "id":"run-1", "strategy":"策略名称", "model":"模型与版本",
      "comparisonGroup":"相同任务输入、模型、工具和环境配置的标识",
      "tokens":null, "durationSec":null,
      "checks":{"g1":{"status":"unknown","evidence":""}},
      "events":[{"atSec":0,"type":"explore","label":"读取文件","detail":"实际日志中的操作描述"}]
    }]
  }]
}
```

## 字段

- `demo`：人工构造示例设为 true；false 只是导入者声明，不能证明真实性。
- `scenario`：coding、research 或 data。
- `weight`：1—5 整数；required 为布尔值。
- `status`：pass、fail 或 unknown。通过与未通过需要非空 evidence。
- `tokens`、`durationSec`：非负数或 null。未知量不要填 0。
- 事件 `type`：explore、act、verify；时间非负、顺序排列，不超出已知总耗时。
- 任务 ID 和运行 ID 各自全局唯一，目标 ID 在任务内唯一。

最大 2 MB、100 个任务，每任务最多 20 项目标与 30 次运行，每运行最多 300 个事件。导入文本转义显示，不作为 HTML 或指令执行。失败导入不替换当前数据，成功导入替换整个会话。

这是自定义数据格式，不是其他 AI 工具的原生日志或 OpenTelemetry 格式。

## 评价规则

目标得分 = 已通过目标的权重 / 全部目标权重。未知不算通过，得分不等于测试成功概率。

推荐资格要求：所有必需项通过（无必需项时要求全部通过）、所有目标已核验、token 已知且在预算内、位于同一任务与选定条件组。之后标记 token 最少的记录，并列时全部标记。

可选目标未通过不直接阻止推荐，但仍显示在得分与证据中。不同模型 token 不等于等价硬件成本。条件组由提供者声明，平台无法独立核实模型、版本、输入和环境是否可比。

## 保存与导出

评估报告包含当前任务、该任务运行记录、当前目标配置、预算和比较结果。它不是输入数据集；重新导入时，将报告的 task 放到带 version、demo 和 tasks 数组的数据集中。

复核修改不写回原始文件，也不自动持久保存。刷新或关闭前请导出。

本机 Codex 适配器额外输出 `source`、`generatedAt`、`usage`、`patch`、`verification`、`settings` 与 `limitations`；这些字段用于保留来源声明、用量分项和验收证据，不改变 v1 核心评价规则。`source` 本身不是真实性证明。适配器保存原始记录到本机 `runs/`，页面人工修改仍需导出。

资料检索对照结果的 `source` 为 `local-retrieval-study`，并增加 `retrievalStudy.protocol`、`retrievalStudy.summary` 和每次运行的 `retrieval`。其中 `selectedIds` 是平台实际提交给模型的资料 ID，`stopReason` 是平台规则记录的停止原因，`promptSha256` 用于确认输入未被悄悄替换。`checks` 仍按 v1 规则核验：模型没有明确依据时为 `unknown`，值或来源引文不匹配时为 `fail`；`outcome` 为 `passed`、`verification_failed`、`insufficient_evidence` 或 `execution_failed`。该扩展记录实验协议，不改变“未知不算通过”的评价口径。
