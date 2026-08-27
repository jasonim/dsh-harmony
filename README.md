# DSH Harmony

将一台通过 USB 连接的 HarmonyOS 真机带入 DeepSeek Harness 对话。Agent
可以发现设备、用 Hvigor 构建 HAP、安装和启动应用、读取 HiLog、截图、
按坐标或控件身份操作 UI，并用本地 OCR 查找文字。Web profile 还会显示一个
可点击、可拖动的右侧真机面板。

首版只支持真机，不支持模拟器或无线 HDC。侧栏使用按需 PNG 截图轮询，目标
刷新率约 0.5–2 FPS；它是可交互预览，不是 15/30 FPS 视频流。

## 能力

插件始终注册 18 tools；设备或某项能力不可用时返回明确错误，不会悄悄换用
另一台设备或执行任意 shell。

| 领域 | Tools |
| --- | --- |
| 设备与能力 | `harmony_devices`, `harmony_capabilities` |
| 构建与应用 | `harmony_build`, `harmony_install`, `harmony_launch`, `harmony_list_apps`, `harmony_app_info` |
| 画面与操作 | `harmony_screenshot`, `harmony_interact` |
| 控件树 | `harmony_ui_tree`, `harmony_tap_element`, `harmony_ui_rows`, `harmony_tap_row` |
| OCR | `harmony_find_text`, `harmony_tap_text`, `harmony_wait_for` |
| 诊断 | `harmony_logs`, `harmony_processes` |

坐标操作绑定当前 `frameId`；过期截图会被拒绝。控件或 OCR 存在多个候选时
也会拒绝点击。所有设备命令都通过参数数组执行，并显式使用
`hdc -t <connect-key>`；对外结果只暴露不可逆的设备摘要。

## 环境要求

- Node.js ≥ 23.11。
- DeepSeek Harness web profile，兼容基线为 DSH 0.1.0-rc.6 及以上。
- DevEco Studio 或可执行的 `hdc`、Hvigor 与 HarmonyOS SDK。
- 一台已解锁、已接受 USB 调试授权且状态为 `USB + Connected` 的真机。
- OCR 仅在 macOS 可用，因为它使用 Apple Vision；其余 tools 不依赖 OCR。

HDC 的查找顺序为 `HARMONY_HDC`、PATH、`DEVECO_SDK_HOME` /
`OHOS_SDK_HOME`，最后是 macOS DevEco Studio 默认目录。Hvigor 可通过
`HARMONY_HVIGOR` 指定。

## 安装到 DSH

在仓库中构建并将本地目录加入 web profile：

```bash
pnpm install
pnpm run build
dsh plugin --profile web add /absolute/path/to/dsh-harmony
dsh web
```

发布 npm 包后，也可以把最后一个参数替换为包名和版本。

## 使用顺序

1. 用 `harmony_devices` 获取 USB 真机的脱敏 id。
2. 用 `harmony_capabilities` 确认目标设备的 UiTest 与 OCR 能力。
3. 需要部署时，先用 `harmony_build` 构建已配置签名的 HarmonyOS 工程，
   再显式调用 `harmony_install` 和 `harmony_launch`。
4. 操作 UI 时优先使用 `harmony_ui_tree` + `harmony_tap_element`；树不可见
   的文字再使用 OCR。只有确实需要时才使用坐标，并引用最新 frameId。
5. 用操作返回的新画面或 `harmony_wait_for` 验证结果。

侧栏只通过插件拥有的同源 `/_dsh/dsh-harmony/*` 路由访问画面。路由要求
loopback peer/Host、同源 Origin/Fetch-Metadata，以及最长十分钟的 HMAC
capability。浏览器不会直接连接 HDC。

## 开发与验证

```bash
pnpm run typecheck
pnpm test
pnpm run test:coverage
pnpm run build
pnpm pack --dry-run
```

仓库包含一个确定性测试页面 `fixtures/harness-app`。它可以用 DevEco
Hvigor 构建，但真机安装仍需开发者自己的有效 HarmonyOS 签名。得到已签名
HAP 后，运行以下安全门：

```bash
node scripts/device-input-gate.mjs --hap /absolute/path/to/signed.hap
```

脚本安装并启动固定 bundle `com.deepseek.dsh.harness`，只有控件树确认该
bundle 位于前台才会执行，然后验证 30 次点击、10 次滑动、10 次文本输入和
一次 Back。它不会在未知前台应用上尝试输入。

更详细的支持矩阵、威胁模型和实现计划见 `docs/` 与 `plans/`。

## 已知边界

- HarmonyOS 命令行录屏只能停止后拉取 MP4，因此没有被伪装为实时流。
- 真机锁屏、隐私窗口或系统策略可能让截图变黑或让 UiTest 拒绝输入；插件
  不会绕过系统限制。
- `harmony_install` 不会因签名冲突自动卸载旧应用或清除数据。
- HiLog、控件树、OCR 和构建输出都有行数或字节上限。

## License

MIT。架构与 OCR helper 的上游归属见 `THIRD_PARTY_NOTICES.md`。
