# DSH Harmony v0.1 支持契约

> 状态：草案；截图与 UI tree 真机门已通过，输入门待验证  
> 更新：2026-08-27

## 用户旅程

1. 作为 HarmonyOS 开发者，我希望 Agent 能发现我通过 USB 授权的真机，以便明确选择一个测试目标。
2. 作为安全敏感用户，我希望工具结果不暴露设备序列号，也不会误选另一台设备。
3. 作为插件维护者，我希望先知道目标真机是否支持 UiTest 截图、控件树和输入，以便按能力降级而不是运行时猜测。
4. 作为开发者，我希望测量连续截图的稳定性，以便判断右侧栏能否提供可交互的实时预览。

## WP0 主机范围

当前探针支持：

- macOS、Linux、Windows 上可执行的 Node.js ESM。
- 通过 `HARMONY_HDC` 显式指定 HDC。
- macOS DevEco Studio 默认 HarmonyOS/OpenHarmony SDK 布局。
- 通过 PATH 启动 `hdc` 的降级路径。

开发机当前观测：

- macOS arm64。
- Node.js v23.11.1。
- HDC 3.2.0c，路径为 DevEco Studio OpenHarmony SDK。
- 2026-08-27 已在一台 USB、Connected、未 Root 零售真机完成观察性探针。
- 设备 UiTest 6.0.2.3；屏幕尺寸 1260 × 2720。

## 设备范围

v0.1 MVP 只接受同时满足以下条件的 target：

- `hdc list targets -v` 可枚举。
- transport 为 `USB`。
- state 为 `Connected`。
- 用户已在设备上完成 USB 调试授权。
- 设备保持解锁。

以下目标在 v0.1 被拒绝：

- TCP、Wi-Fi、远程设备。
- Unauthorized、Offline、Ready/Unknown 状态。
- 未显式选择的多设备写操作。
- Root 后手动替换系统 UiTest 的设备。

## UiTest 能力门

版本只是预判，最终能力以命令探测和真机行为为准。

| UiTest | 预期能力 |
| --- | --- |
| `< 4.1.2.0` | 可尝试截图和控件树；shell UI 输入关闭 |
| `>= 4.1.2.0` | shell `uiInput` 候选能力 |
| `>= 4.1.4.0` | rich tree 候选能力，含 hint/description |
| `>= 5.1.1.1` | 当前焦点文本输入候选能力 |
| `>= 5.1.1.2` | 按 bundle/window 获取控件树候选能力 |

探针还会检查 help 中是否实际列出：

- `screenCap`
- `dumpLayout`
- `uiInput`
- `click`、`swipe`、`drag`
- `inputText`、`text`、`keyEvent`

## 探针命令

列出设备，只产生脱敏 id：

```bash
node scripts/probe-device.mjs --list
```

针对脱敏 id 运行观察性探针：

```bash
node scripts/probe-device.mjs --device device-xxxxxxxxxxxx --all
```

连续截图 soak，范围 1–500：

```bash
node scripts/probe-device.mjs --device device-xxxxxxxxxxxx --soak 100
```

如果 HDC 不在默认位置：

```bash
HARMONY_HDC=/absolute/path/to/hdc node scripts/probe-device.mjs --list
```

`--all` 当前只执行观察性操作：版本/help、截图和控件树。它不会点击、输入、安装、启动、卸载或清数据。

## 报告隐私

- 输出使用 `device-<sha256前12位>`，不返回 connect-key。
- 不返回截图路径、截图内容、控件树内容或 UiTest stderr 原文。
- 截图和控件树临时文件使用 `/data/local/tmp/dsh-harmony-probe-*`，完成后尽力清理。
- 本地临时文件在读取后删除。
- 进程输出有硬上限，命令有硬超时。

## Go/No-Go 标准

### 必须通过

- 一台未 Root 目标零售真机可稳定截图。
- UiTest 输入命令在确定性测试页面可稳定 click/swipe/Back。
- 未授权、锁屏、拔线返回结构化失败，不挂死进程。
- 截图 soak 没有任务积压。

### 可降级

- `dumpLayout` 不存在、过慢或结构不稳定：关闭 UI tree，保留截图 + OCR。
- OCR backend 不可用：保留截图和基础坐标控制。
- 截图刷新低于 0.5 FPS：侧栏降级为按需刷新，不宣称实时预览。

### 必须停止并重新设计

- 未 Root 零售真机无法稳定截图。
- shell UI 输入在目标系统不可用或只能操作测试进程自身。
- 截图或输入必须绕过系统权限、替换系统二进制或安装跨应用辅助服务。

## 2026-08-27 真机结果

| 检查项 | 结果 |
| --- | --- |
| USB 枚举 | `PASS`；1 台 `USB + Connected` 设备 |
| UiTest 可用性 | `PASS`；版本 6.0.2.3 |
| 截图 | `PASS`；1260 × 2720 PNG，单次探针约 1269 ms |
| UI tree | `PASS`；约 77 KB，可解析 JSON，约 1445 ms |
| 100 帧 soak | `PASS`；100/100 成功，0 失败 |
| 截图耗时 | min 965.70 ms，mean 1062.37 ms，p50 1058.72 ms，p95 1131.13 ms，max 1214.19 ms |
| 预览候选刷新率 | 约 0.94 FPS，满足 0.5–2 FPS 的 v0.1 目标区间 |
| 输入命令发现 | `PARTIAL`；help 暴露 `uiInput`、`click`、`inputText`、`keyEvent`，未暴露独立 `swipe`/`drag` 命令 |
| 实际 click/swipe/Back | `UNVERIFIED`；等待确定性测试 HAP/页面，避免操作未知前台界面 |

本次探针只保存聚合指标；没有持久化截图、完整控件树或 raw connect-key。

## 当前结论

截至 2026-08-27：探针实现、单元/集成测试和安全输出契约已完成。截图、UI tree 与 100 帧稳定性门已通过；输入行为门仍为 `UNVERIFIED`。在确定性测试页面验证 click/swipe/Back 之前，WP1 可以搭建只读设备会话骨架，但不得开放写入型工具或宣称完整交互可行。
