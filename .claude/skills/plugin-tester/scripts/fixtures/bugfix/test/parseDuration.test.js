const test = require('node:test');
const assert = require('node:assert');
const { parseDuration } = require('../src/parseDuration');

// 现状唯一的测试：只覆盖 happy path。'30m' / '1h' 的缺陷没有测试覆盖——
// 这正是 bug 长期未被发现的现实形态。bugfix 工作流应先补失败回归测试再修。
test('parses combined hours and minutes', () => {
  assert.strictEqual(parseDuration('1h30m'), 90);
});
