# @deepseek-ai/dsh-principal-hmac

[English](README.md) | 中文

`ctx.principal` 的 HMAC 认证器，使用 CoreNet `HarnessLaunchToken` 算法（`payload.signature`，声明 `tid`、`uid`、`product?`、`exp`）。Cookie 名默认 `harness_launch`；也接受 `Authorization: Bearer`。这是对托管叠加层启动 cookie 的进程内再校验——叠加层代理在 `examples/hosted-generate/azure/launch-token.mjs` 中保留自己的副本。默认 `dsh web` 不挂载此插件。决策记录：[hosted principal Agent Note](../../../.agents/notes/implemented/architecture/2026-09-03-hosted-principal-isolation.zh.md)。

## 配置

- `secret`（必填）— 与 CoreNet / 叠加层共享的 HMAC 密钥。空字符串在加载时失败。
- `cookieName`（默认 `harness_launch`）— 先于 Bearer 解析的 cookie。
- `secureCookie`（默认 `true`）— 登出 `Set-Cookie` 包含 `Secure`。
- `product`（可选）— 设置后，claims.product 必须等于该值。

`auth.logout` 清除 cookie（`Max-Age=0`）。从不读取 email。令牌从不写入 workspace 记录。

## 模型体验

### 请求上下文与条件

#### 模型看到什么

无。认证器只识别宿主 RPC 调用方。

#### Token 影响

每次请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：此包绝不触及请求前缀，因此不会使提供方缓存复用失效。

## 已知限制与暂缓事项

- 过期只看 `exp`；没有服务端吊销集合。
- 叠加层代理仍在边缘做 HMAC 门控。本插件是附加的，因此 dsh 不信任转发的身份头。
