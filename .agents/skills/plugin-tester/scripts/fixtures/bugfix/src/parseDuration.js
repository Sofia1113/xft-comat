// 时长解析：'1h30m' → 90（分钟）。
// 已知缺陷：只有小时或只有分钟的输入（如 '30m' / '1h'）会因 match 返回 null 而抛错。
// 这是预埋的待修 bug——bugfix 工作流应先复现、定位根因，再修复并补回归测试。
function parseDuration(s) {
  const h = s.match(/(\d+)h/)[1];
  const m = s.match(/(\d+)m/)[1];
  return Number(h) * 60 + Number(m);
}

module.exports = { parseDuration };
