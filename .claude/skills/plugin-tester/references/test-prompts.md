# 测试 Prompt 清单（xft-comat · 5 mode）

5 个用例分别覆盖 `feature-simple`、`feature-medium`、`feature-hard`、`bugfix`、`refactor`。验证“所有 workflow/mode”时一轮全跑，至少每种 mode 一条。

sandbox 是空壳 Node 项目（`README.md`、`package.json`、占位 `npm test`）。每个 prompt 都自带足够上下文，让被测插件从零创建或修改文件。

每个用例都只写用户真实需求，不写“使用哪个 mode”“先 route 再 implement”之类工作流指令。mode 必须由 `pilot`（主 skill）自己判断。

---

## feature-simple — 单模块规则化纯函数

**prompt**:

```text
写一个 `src/normalizeTags.js`，导出 `normalizeTags(input, options)`：

- `input` 可以是字符串数组，也可以是用逗号分隔的字符串。
- 每个 tag 要 trim、转小写，并把内部连续空白折叠为单个空格。
- 空 tag 要丢弃。
- 默认去重，保留第一次出现的顺序。
- `options.maxTags` 可限制最多返回多少个 tag；缺省不限制。
- `options.allowDuplicates === true` 时不要去重。
- 非字符串 tag 要忽略。

请补对应测试并确保 `npm test` 能跑。示例：`normalizeTags(" JS, ai tools, JS ,,  Claude Code ", { maxTags: 3 })` 返回 `["js", "ai tools", "claude code"]`。
```

**预期 mode**: `feature-simple` — 单模块纯函数，规则完整明确，虽有多个边界但不涉及多模块、外部依赖或架构取舍。

**关键观察点**：

- ✅ route 后模型自评为 `feature-simple`，不是由脚本自动判断。
- ✅ 不因边界用例较多误升为 `feature-medium` / `feature-hard`。
- ✅ 创建轻量 `01-requirements.md`、`02-design-note.md`、测试用例和任务记录。
- ✅ 通常不分派 specialist；如果分派，应能说明独立价值。
- ✅ 先补测试，再实现，再跑测试。
- ✅ 测试至少覆盖字符串输入、数组输入、去重顺序、`allowDuplicates`、`maxTags`、空值/非字符串忽略。
- ❌ 反模式：升成 `feature-hard`；为单模块任务做复杂多 agent 编排；跳过测试；只测示例不测选项和边界。

**决策模拟参考**: 如果问非数组/非字符串整体输入如何处理，选保守规则：返回空数组；确认时偏轻量，不展开架构讨论。

---

## feature-medium — 多模块 REST API

**prompt**:

```text
做一个最小的 Express REST API 管理 todo：`GET /todos` 列出、`POST /todos` 新建（body 含 `title`）、`DELETE /todos/:id` 删除。数据存内存即可。请拆成路由层和内存存储层两个模块，并配单元测试。
```

**预期 mode**: `feature-medium` — 多文件、多模块，有有限设计取舍，但边界清楚。

**关键观察点**：

- ✅ 定级 `feature-medium`，并说明复杂度命中多模块/测试策略。
- ✅ `02-design.md` 记录推荐方案；只有真实取舍才 AskUserQuestion。
- ✅ 可使用 `xft-comat-architect`，但不应额外分派无关 agent。
- ✅ `skills list` 后记录相关 skill 决策；普通 API 不应把 `agent-browser` 记为 required。
- ✅ 测试覆盖三个端点和删除不存在 id。
- ❌ 反模式：降成 simple；跳过设计记录；实现时不拆模块；验证失败仍 close。

**决策模拟参考**: 如果问 id 生成方式，选递增数字或 Other 指定“内存递增 id 即可”；测试框架选中间项，避免连续默认。

---

## feature-hard — JWT 认证与密码安全

**prompt**:

```text
设计并实现一个带 JWT 认证的用户系统骨架：注册、登录签发 token、一个需要鉴权才能访问的受保护接口。密码要安全存储。给出可扩展的分层结构（路由 / 服务 / 中间件 / 存储），关键路径配测试。
```

**预期 mode**: `feature-hard` — 涉及认证、密码安全、跨层结构和关键架构抉择。

**关键观察点**：

- ✅ 定级 `feature-hard`，命中安全/多模块/架构取舍/测试策略。
- ✅ 逐轮澄清关键问题，不一次问一长串。
- ✅ 使用 `xft-comat-architect` 或等价 architect 方案，并在 `02-design.md` 开头记录用户最终抉择。
- ✅ 密码哈希存储，不明文；token 策略和错误处理有说明。
- ✅ 测试覆盖注册、登录、鉴权成功和鉴权失败。
- ❌ 反模式：降成 medium/simple；跳过用户关键抉择；密码明文；没有严格验证。

**决策模拟参考**: 存储选“内存即可，重启清空”；token 过期给明确值（如 1 小时）；至少一题用 Other 指定“优先 Node 标准库 crypto/scrypt，避免额外依赖，除非实现复杂度太高”。

---

## bugfix — 明确复现和根因的 localized 修复

**prompt**:

````text
下面这个时长解析函数，`'1h30m'` 能正确解析成 90，但只有分钟的输入如 `'30m'` 会抛错。请把它建到 `src/parseDuration.js`，先用测试复现这个 bug，再修好，让缺小时或缺分钟的输入都能正确解析。

```js
function parseDuration(s) {
  const h = s.match(/(\d+)h/)[1];
  const m = s.match(/(\d+)m/)[1];
  return Number(h) * 60 + Number(m);
}
```

报错：`parseDuration('30m')` → `TypeError: Cannot read properties of null (reading '1')`
````

**预期 mode**: `bugfix` — 用户描述了错误、复现输入和异常，范围集中在单函数。

**关键观察点**：

- ✅ 定级 `bugfix`，不是 feature。
- ✅ 先记录复现和根因：`match` 返回 `null` 仍取 `[1]`。
- ✅ 先写失败回归测试，再改实现。
- ✅ 测试覆盖 `'30m'`、`'1h'`、`'1h30m'`、非法或空输入的预期行为（若澄清后确定）。
- ❌ 反模式：跳过复现；升成 hard；引入无关模块；没有回归测试。

**决策模拟参考**: 若问非法输入如何处理，选保守方案：抛出明确错误或返回 0，但要选一个并要求测试固定。其余交互尽量少往返。

---

## refactor — 行为不变的结构整理

**prompt**:

```text
我有一个内联在 `src/cart.js` 里的购物车总价计算逻辑，请先创建这个文件和测试：商品包含 `price`、`quantity`，支持百分比折扣 `discountPercent`，总价保留两位小数。然后在不改变现有行为的前提下，把计算逻辑重构成更容易测试和复用的小函数，保留等价性验证。
```

**预期 mode**: `refactor` — 用户明确要求行为不变的结构改善，并要求等价性验证。

**关键观察点**：

- ✅ 定级 `refactor`，不走新功能设计流程。
- ✅ 记录行为基线、安全网和等价验证。
- ✅ 先建立测试保护，再拆函数。
- ✅ 不改变价格、折扣和四舍五入行为。
- ❌ 反模式：当成 feature-medium；新增不必要业务能力；无基线直接重构；验证只跑 happy path。

**决策模拟参考**: 如果问折扣边界，选择保守且可测的规则：`discountPercent` 缺省为 0，范围 0-100，越界抛错。强调“行为固定后再重构”。

---

## 决策风格轮换

| mode | 决策取向 |
|---|---|
| `feature-simple` | 轻量，选第 2 项或直接批准 |
| `feature-medium` | 中间项 + 一题具体 Other |
| `feature-hard` | 多样且明确：内存存储、token 过期、密码哈希策略 |
| `bugfix` | 最少往返，固定边界行为后批准 |
| `refactor` | 保守，强调行为不变和安全网 |

跑完每个 prompt，记下实际选择；下一个 prompt 主动换风格。这能验证插件在不同用户决策下是否稳定，而不是只适配 Recommended 路径。
