# identity/ — 共享身份

[English](README.md) | 中文

跨产品领域共享的身份值。匿名遥测 id 不是经过身份验证的账户；`ctx.principal` 才是经过认证的宿主调用方。

| 包 | 职责 | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.zh.md) | 为遥测、反馈和 DeepSeek 请求持久化一个限定于 Harness home 的匿名关联 id | — |
| [`principal/`](principal/README.zh.md) | 请求作用域的已认证调用方与认证器注册表 | `ctx.principal` |
| [`principal-hmac/`](principal-hmac/README.zh.md) | CoreNet HMAC 启动令牌认证器（`harness_launch`） | 注册到 `ctx.principal` |
| [`hosted-limits/`](hosted-limits/README.zh.md) | kill switch、每用户上限、git 速率限制、隔离检出根目录 | `ctx.hostedLimits` |
