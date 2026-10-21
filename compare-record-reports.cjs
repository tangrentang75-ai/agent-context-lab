'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const text = (value, max = 3000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const { validateReport, compareReports } = require('./report-comparison.js').createComparator({
  evaluation: require('./evaluation.js'),
  ruleHash: hash(fs.readFileSync(require.resolve('./evaluation.js'))),
  softwareVersion: require('./package.json').version
});

function readReport(filename) {
  const fd = fs.openSync(filename, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) fail('报告必须为不超过 16MiB 的普通文件');
    const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
    let length = 0, count;
    while (length < buffer.length && (count = fs.readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += count;
    if (length > MAX_REPORT_BYTES) fail('报告超过 16MiB');
    const bytes = buffer.subarray(0, length);
    return { report: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), sha256: hash(bytes) };
  } finally { fs.closeSync(fd); }
}

function main(args = process.argv.slice(2)) {
  try {
    if (args.length === 1 && args[0] === '--help') {
      process.stdout.write('node compare-record-reports.cjs --before before.json --after after.json [--output difference.json]\n只比较已有评估报告，不调用模型。拒绝覆盖输出。退出码：0 已检查内容一致；1 有差异、条件变化或待核对；2 输入/写入错误。\n');
      return 0;
    }
    const options = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (!['--before', '--after', '--output'].includes(args[i]) || options.has(args[i]) || !text(args[i + 1]) || args[i + 1].startsWith('--')) fail('未知、重复或缺值的参数；使用 --help 查看用法');
      options.set(args[i], args[i + 1]);
    }
    if (!options.has('--before') || !options.has('--after')) fail('必须提供 --before 和 --after');
    const before = readReport(options.get('--before')), after = readReport(options.get('--after'));
    const report = compareReports(before.report, after.report);
    report.reportFiles = { beforeSha256: before.sha256, afterSha256: after.sha256 };
    const json = JSON.stringify(report, null, 2) + '\n';
    if (options.has('--output')) fs.writeFileSync(options.get('--output'), json, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(json);
    return report.status === 'unchanged' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`比较未完成：${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { compareReports, validateReport, readReport, MAX_REPORT_BYTES };
