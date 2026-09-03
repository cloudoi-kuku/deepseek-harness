# @deepseek-ai/dsh-principal

[English](README.md) | 中文

DeepSeek Harness 宿主 RPC 的请求作用域产品主体（`ctx.principal`）。认证器按 id 注册，从 HTTP 请求识别调用方；`run` 通过 `AsyncLocalStorage` 绑定该调用方，使工作区所有权与检出隔离可以读取 `current()`，而无需传递请求对象。默认的 `dsh web` 组合不挂载此服务。已挂载但零认证器的服务在授权上等同于未挂载（所有工作区仍可见，`create({ path })` 不变）。服务上从不存储令牌。决策记录：[hosted principal Agent Note](../../../.agents/notes/implemented/architecture/2026-09-03-hosted-principal-isolation.zh.md)。

## 结构

- `ctx.principal.register(authenticator)`：注册一种识别策略。重复 `id` 会抛错。处置器在 fiber 销毁时注销。
- `hasAuthenticators()`：至少注册了一个认证器时为 true；工作区过滤与隔离 git 检出依据此项，而不是服务是否存在。
- `bindFromRequest(request)`：第一个匹配的认证器胜出；不绑定 ALS。
- `run(principal, fn)` / `current()` / `require(action)`：在一次异步续体中绑定并读取调用方。并发 `run` 不共享存储。
- `logout(request)`：合并每个认证器的 `Set-Cookie` 清除。HTTP 载体在 `auth.logout` 上附加这些头。

HMAC CoreNet 启动 cookie 是提供者（`dsh-principal-hmac`），不是本定义。OSS 目录选择器版 `dsh web` 保持未认证。

## 模型体验

### 请求上下文与条件

#### 模型看到什么

无。`ctx.principal` 只为宿主侧授权服务：本包不注册工具、不注入提示词、不写入会话事件。

#### Token 影响

每次请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：此包绝不触及请求前缀，因此不会使提供方缓存复用失效。

## 已知限制与暂缓事项

- 认证器只负责识别，不持久化吊销列表。过期依据令牌的 `exp`。服务端吊销是后续提供者的职责。
- GitHub OAuth 与其他公开产品签发方是后续认证器；本切片在定义旁交付 HMAC CoreNet 提供者。
