// 购物车总价：所有逻辑（行小计、按项百分比折扣、累加、两位小数舍入）
// 全内联在一个函数里。refactor 工作流应在不改变外部行为的前提下，
// 把它拆成更易测试复用的小函数，并保留等价性验证。
function cartTotal(items) {
  let total = 0;
  for (const item of items) {
    const price = item.price;
    const quantity = item.quantity;
    const discountPercent = item.discountPercent || 0;
    const lineTotal = price * quantity;
    const discounted = lineTotal - lineTotal * (discountPercent / 100);
    total += discounted;
  }
  return Math.round(total * 100) / 100;
}

module.exports = { cartTotal };
