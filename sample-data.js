// All records below are handcrafted demonstrations, not model measurements.
(function(root) {
  const makeRun = (id, strategy, group, tokens, durationSec, goals, states, evidence, events) => ({
    id, strategy, comparisonGroup: group, model: '演示模型 / 非实际调用', tokens, durationSec,
    checks: Object.fromEntries(goals.map((g, i) => [g.id, { status: states[i], evidence: evidence[i] }])),
    events: events.map((e, i) => ({ atSec: Math.floor(durationSec * i / events.length), type: e[0], label: e[1], detail: e[2] }))
  });
  const coding = [
    {id:'refund',label:'取消报名后释放名额',required:true,weight:5},
    {id:'duplicate',label:'重复请求不产生重复记录',required:true,weight:5},
    {id:'regression',label:'原有报名流程正常',required:true,weight:4},
    {id:'docs',label:'补充清晰的修改说明',required:false,weight:2}
  ];
  const research = [
    {id:'source',label:'重要结论有可追溯的一手来源',required:true,weight:5},
    {id:'date',label:'区分发布时间与事件时间',required:true,weight:4},
    {id:'conflict',label:'标注来源之间的分歧',required:true,weight:4},
    {id:'brief',label:'摘要控制在指定篇幅',required:false,weight:2}
  ];
  const dataGoals = [
    {id:'dedup',label:'按订单编号正确去重',required:true,weight:5},
    {id:'missing',label:'缺失金额保留为未知',required:true,weight:5},
    {id:'total',label:'汇总数额可复核',required:true,weight:4},
    {id:'chart',label:'提供可读的趋势图',required:false,weight:2}
  ];
  root.AGENT_SAMPLE = {version:1,demo:true,tasks:[
    {id:'signup-fix',title:'修复活动报名与名额恢复',description:'为校园活动修复取消报名后的名额问题，同时保持重复请求和原有流程正确。',scenario:'coding',goals:coding,runs:[
      makeRun('code-a','快速直接修改','代码示例 / 同一版本与模型',3200,84,coding,['pass','fail','pass','fail'],['模拟测试：取消后名额增加 1。','模拟测试：重复请求创建了两条记录。','模拟回归：普通报名通过。','示例补丁没有修改说明。'],[['explore','读取报名接口','直接定位报名处理函数。'],['act','修改名额更新逻辑','增加取消时的名额回补。'],['verify','运行基础测试','基础路径通过，重复请求检查未通过。']]),
      makeRun('code-b','针对目标探索','代码示例 / 同一版本与模型',7600,146,coding,['pass','pass','pass','pass'],['模拟独立测试：取消与释放名额一致。','模拟测试：重复请求只创建一条记录。','模拟回归：原有流程通过。','示例记录包含修改原因与验证方式。'],[['explore','定位报名与取消入口','读取与必需目标相关的两个处理入口。'],['explore','检查事务与去重约束','确认请求幂等键及数据库更新边界。'],['act','修复并保留已有行为','在事务内更新名额，复用原有去重逻辑。'],['verify','验证三项核心要求','执行取消、重复请求与回归测试。']]),
      makeRun('code-c','广泛探索后修改','代码示例 / 同一版本与模型',14800,291,coding,['pass','pass','pass','pass'],['模拟测试通过。','模拟测试通过。','模拟回归通过。','示例记录包含完整说明。'],[['explore','阅读项目结构','遍历接口、前端和管理页面。'],['explore','补充阅读通知与样式','记录这次阅读，但不能仅凭范围判定无用。'],['explore','检查数据库约束','确认事务与去重规则。'],['act','实施修复','更新取消逻辑。'],['verify','执行验证','模拟测试结果均通过。']])]},
    {id:'campus-research',title:'整理校园 AI 使用研究简报',description:'从提供的资料包提炼可追溯结论，保留分歧与时间信息，形成简洁摘要。',scenario:'research',goals:research,runs:[
      makeRun('research-a','先汇总再核查','研究示例 / 相同资料包',5200,112,research,['pass','pass','unknown','pass'],['示例引用索引对应原文片段。','示例中分别记录两类日期。','','示例摘要满足篇幅要求。'],[['explore','阅读资料包','提取来源、日期和主要论点。'],['act','生成简报','组织引用与摘要。'],['verify','检查引用与篇幅','分歧检查尚未完成，不能宣布全部验收通过。']]),
      makeRun('research-b','围绕验收逐项核查','研究示例 / 相同资料包',8300,178,research,['pass','pass','pass','pass'],['示例所有重要结论均关联资料片段。','示例日期标注通过人工复核。','示例保留了两项相互冲突的结论。','示例摘要通过篇幅检查。'],[['explore','建立来源索引','整理资料出处及时间。'],['explore','比对结论分歧','查找相反结论的上下文。'],['act','组织研究简报','区分共识、分歧与待验证内容。'],['verify','逐项检查目标','模拟人工复核全部完成。']])]},
    {id:'order-cleanup',title:'清洗订单数据并核对汇总',description:'处理重复订单与缺失金额，保留可追溯的清洗记录；趋势图属于可选改进。',scenario:'data',goals:dataGoals,runs:[
      makeRun('data-a','先完成表格与图表','数据示例 / 同一输入文件',4100,78,dataGoals,['pass','fail','fail','pass'],['模拟检查：按编号去重正确。','示例错误：空金额被填成 0。','汇总未区分缺失金额。','示例包含趋势图。'],[['explore','读取表格结构','识别订单编号和金额列。'],['act','清洗并绘图','去重后把缺失金额填为 0。'],['verify','检查图表与行数','图表存在，但必需的缺失处理规则未通过。']]),
      makeRun('data-b','先保证数据规则','数据示例 / 同一输入文件',6200,125,dataGoals,['pass','pass','pass','fail'],['模拟去重检查通过。','示例空金额保留为空，并独立计数。','示例汇总包含有效金额与缺失记录数量。','示例尚未生成可选趋势图。'],[['explore','明确去重与缺失规则','根据任务约定保留未知值。'],['act','执行数据清洗','生成清洗后的数据与变更记录。'],['verify','核对汇总','模拟核算有效金额与缺失记录。']])]}]};
})(globalThis);
