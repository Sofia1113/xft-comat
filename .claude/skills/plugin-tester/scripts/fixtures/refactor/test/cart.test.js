const test = require('node:test');
const assert = require('node:assert');
const { cartTotal } = require('../src/cart');

// 行为基线：覆盖累加、按项折扣、两位小数舍入。是 refactor 的安全网起点，
// 够用但不充分——refactor 工作流应在重构前补足等价性/特征测试再动结构。
test('sums price * quantity across items', () => {
  assert.strictEqual(cartTotal([{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }]), 25);
});

test('applies per-item percentage discount', () => {
  assert.strictEqual(cartTotal([{ price: 100, quantity: 1, discountPercent: 10 }]), 90);
});

test('rounds total to two decimals', () => {
  assert.strictEqual(cartTotal([{ price: 0.1, quantity: 3 }]), 0.3);
});
