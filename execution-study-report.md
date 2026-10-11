# v0.18 执行链路开发检查记录

生成于 2026-10-07T04:36:30.278Z。协议 `execution-study-c80d598a-0c75-42d1-81e2-f92fc9bc1842`，状态 **stopped**，41/64 格落盘，23 格未运行。停止原因：未知用量，停止后续调用。

已尝试 41 次模型调用，已知 595,390 tokens，1 次用量不完整。未知用量不记零，已知部分保留。最终用户验收数 **0**。

| 路径 | 已记录 | 已评分 | 候选通过 | 已知 tokens | 未知用量 | 最终验收 |
|---|---:|---:|---:|---:|---:|---:|
| full | 21 | 20 | 14 | 298363 | 1 | 0 |
| candidate | 20 | 20 | 8 | 297027 | 0 | 0 |

8个开发者人工题，主题与前期任务重叠，是接入与候选检查集。四次重复预定日程中途停止时分母和题目覆盖可能不齐，不能视为均衡对照或推断效率、泛化和自然遗漏概率。候选响应通过不代表用户任务完成；tokens不是硬件算力。

**执行中发现验收口径不足：**value只要求字符串或null，没有明确禁止单位；冻结标准却要求纯数字，例如回答“31 天”“2.5 秒”“4 submissions per day”会被判字符串不匹配。这类不通过不能直接解释为语义错误。保留原评分，不事后改口径或重算通过率；下轮需要把输出格式与单位约定明确写入任务。

| 配置格 | 执行 | 评分 | tokens | 引文警告 |
|---|---|---|---:|---|
| notice-replacement:1:full | complete | 通过 | 14846 | 0 |
| notice-replacement:1:candidate | complete | 通过 | 14872 | 0 |
| equal-authority:1:candidate | complete | 未通过 | 14803 | 0 |
| equal-authority:1:full | complete | 通过 | 14926 | 0 |
| zero-retry:1:full | complete | 通过 | 14939 | 0 |
| zero-retry:1:candidate | complete | 通过 | 14877 | 0 |
| strict-boundary:1:candidate | complete | 未通过 | 15019 | 0 |
| strict-boundary:1:full | complete | 未通过 | 14964 | 0 |
| missing-quota:1:full | complete | 通过 | 14815 | 0 |
| missing-quota:1:candidate | complete | 通过 | 14774 | 1 |
| two-goals:1:candidate | complete | 未通过 | 14805 | 2 |
| two-goals:1:full | complete | 未通过 | 14934 | 0 |
| unicode-offset:1:full | complete | 通过 | 14897 | 0 |
| unicode-offset:1:candidate | complete | 未通过 | 14764 | 0 |
| scope-english:1:candidate | complete | 未通过 | 14855 | 0 |
| scope-english:1:full | complete | 未通过 | 14961 | 0 |
| notice-replacement:2:candidate | complete | 通过 | 14851 | 0 |
| notice-replacement:2:full | complete | 通过 | 14897 | 0 |
| equal-authority:2:full | complete | 通过 | 14929 | 0 |
| equal-authority:2:candidate | complete | 未通过 | 14780 | 0 |
| zero-retry:2:candidate | complete | 通过 | 14847 | 0 |
| zero-retry:2:full | complete | 通过 | 14944 | 0 |
| strict-boundary:2:full | complete | 通过 | 14974 | 0 |
| strict-boundary:2:candidate | complete | 未通过 | 14875 | 1 |
| missing-quota:2:candidate | complete | 通过 | 14925 | 0 |
| missing-quota:2:full | complete | 通过 | 14800 | 0 |
| two-goals:2:full | complete | 未通过 | 14909 | 0 |
| two-goals:2:candidate | complete | 未通过 | 14887 | 1 |
| unicode-offset:2:candidate | complete | 未通过 | 14806 | 0 |
| unicode-offset:2:full | complete | 通过 | 14904 | 0 |
| scope-english:2:full | complete | 未通过 | 14974 | 0 |
| scope-english:2:candidate | complete | 未通过 | 14845 | 0 |
| notice-replacement:3:full | complete | 通过 | 14912 | 0 |
| notice-replacement:3:candidate | complete | 通过 | 14857 | 0 |
| equal-authority:3:candidate | complete | 未通过 | 14792 | 0 |
| equal-authority:3:full | complete | 通过 | 14922 | 0 |
| zero-retry:3:full | complete | 通过 | 14958 | 0 |
| zero-retry:3:candidate | complete | 通过 | 14900 | 0 |
| strict-boundary:3:candidate | complete | 未通过 | 14893 | 0 |
| strict-boundary:3:full | complete | 未通过 | 14958 | 0 |
| missing-quota:3:full | failed | 未评分 | 未知 | 1 |

审核当前与存档源码哈希、日程前缀、原始回执副本和重新评分、费用累计、未运行格数通过。未修改旧v3停止协议。完整输入/源码/回执只保存在本机，未上传。规则见 [执行前协议](execution-study-plan.md)。
