# DSH Harmony v0.1 威胁模型

> 状态：WP0 基线  
> 更新：2026-08-27

## 资产

- 真机上的账号、消息、支付、个人数据和应用状态。
- USB connect-key 与设备身份。
- 截图、OCR 文本和控件树。
- 应用签名材料和构建日志。
- DSH session、Web capability 和本地缓存。
- 用户项目及构建产物。

## 信任边界

```text
Agent request
  -> DSH tool schema
  -> plugin host process
  -> HDC server/USB daemon
  -> retail device

Browser client
  -> DSH same-origin webserver
  -> plugin signed routes
  -> latest-frame cache / control queue
```

Agent 请求不是用户的物理手势。用户在侧栏直接点击也不能自动授予 Agent 后续写权限。

## 主要威胁与控制

| 威胁 | 影响 | WP0/MVP 控制 |
| --- | --- | --- |
| 误选另一台设备 | 操作错误真机 | 多设备写操作必须显式 device；所有 HDC 命令带 `-t` |
| 使用 Wi-Fi target | 扩大网络攻击面 | v0.1 只接受 USB + Connected |
| 命令注入 | 主机或设备执行任意命令 | 参数数组、`shell:false`、无任意 shell 工具 |
| 输出洪泛 | 内存耗尽/挂死 | 输出字节上限、命令超时、子进程回收 |
| 序列号泄露 | 设备可跟踪 | 工具/UI 只显示不可逆哈希摘要 |
| 截图/控件树泄露 | 暴露个人信息 | 本地处理、不返回原始内容、临时文件清理 |
| 陈旧画面点击 | UI 已变化仍执行 | MVP 要求 frameId + orientation + dimensions |
| 歧义元素点击 | 真实账号误操作 | 多候选拒绝；禁止点击试探 |
| 锁屏/敏感界面写入 | 安全或账号风险 | 前台/锁屏 gate；敏感界面默认拒绝 |
| 自动卸载/清数据 | 不可恢复数据丢失 | 默认禁止，签名冲突只返回错误 |
| Web token 泄露/重放 | 远程看屏或控机 | WP5 HMAC、短 TTL、session/action 绑定、sequence、防重放 |
| DNS rebinding/外部 Origin | 绕过 localhost | WP5 校验 peer、Host、Origin、Fetch-Metadata |
| 路径穿越/软链 | 读取任意主机文件 | 固定缓存根、realpath containment、拒绝软链 |

## WP0 探针安全约束

- 只接受 `--list`、`--all` 和有界 `--soak`。
- 不提供 click、input、install、launch、uninstall、clean 参数。
- 设备报告不包含 raw connect-key。
- Artifact id 只允许安全字符，远端路径固定在 `/data/local/tmp/dsh-harmony-probe-*`。
- 远端清理只能针对本次生成的固定前缀路径。
- 无论 UiTest stderr 包含什么，公开报告只返回内部错误码。

## 剩余风险

1. 设备或 HDC 版本可能输出未见过的格式；解析器必须保守降级。
2. 零售系统可能对 `screenCap`、`dumpLayout` 或 `uiInput` 施加未文档化限制。
3. 隐私窗口可能返回黑屏；插件不得尝试绕过。
4. 截图临时文件远端清理是 best-effort；断线时可能留在 `/data/local/tmp`。
5. device hash 在同一 connect-key 下稳定，可关联同一设备；它只用于本地展示，不应上传遥测。

## 安全验收

- 特殊字符参数和路径注入测试通过。
- 实现中不存在 `shell:true`。
- 非 USB/非 Connected 设备被拒绝。
- 原始序列号不出现在 JSON 报告。
- timeout 与 output cap 可终止子进程。
- 临时路径不能通过 idFactory 逃逸。
- WP5 前不向浏览器暴露任何截图或控制端点。
