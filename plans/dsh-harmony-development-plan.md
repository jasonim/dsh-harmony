# DSH Harmony 真机插件开发计划

> 状态：实现完成（RC）；仅剩可信签名 HAP 的真机输入行为门
> 日期：2026-08-27  
> 仓库：`dsh-harmony`  
> 参考实现：[`ZSeven-W/dsh-ios`](https://github.com/ZSeven-W/dsh-ios)，研究基线 `main@9e3b600ba556baf64bbe74ebf39fa1b2ce30545c`

## 1. 目标

开发一个 DeepSeek Harness（DSH）HarmonyOS 插件，把 USB 连接的 HarmonyOS 真机带入对话：Agent 能发现设备、构建和部署应用、读取日志、截图、操作 UI、通过 OCR 或控件树定位元素，并在 DSH 右侧栏看到可点击和拖动的真机实时预览。

本项目只支持真机，不实现模拟器。

## 2. 已确认的技术事实

- DSH iOS 参考插件由 Cordis/DSH 工具注册、设备后端、安全 Web 路由、`presentationMeta`、React 侧栏和内置操作技能组成。可复用的是插件结构、安全设计和客户端交互，不是 iOS 平台后端。
- HarmonyOS 官方 `hdc` 提供 USB 设备发现、指定目标、shell、应用安装、文件传输和 HiLog。
- OpenHarmony ArkXTest 文档提供 `uitest screenCap`、`dumpLayout` 和 `uiInput`。shell 方式的 UI 输入从 UiTest 4.1.2.0 加入；后续版本补充了 hint/description、中文输入优化和按 bundle/window 获取控件树。
- 官方命令行录屏是“开始录制—停止—拉取 MP4”，不是低延迟交互流。首版侧栏必须以轮询截图实现“实时预览”，不能承诺视频级帧率。
- 当前开发机已有 DevEco Studio 内置 `hdc 3.2.0c`。计划编写时未发现真机；实施 WP0 时已在一台 USB 零售真机验证 UiTest 6.0.2.3 的截图和 UI tree。

主要资料：

- [dsh-ios README 与安全设计](https://github.com/ZSeven-W/dsh-ios)
- [HarmonyOS HDC 官方文档](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/hdc)
- [OpenHarmony ArkXTest README](https://gitee.com/openharmony/testfwk_arkxtest/blob/master/README_zh.md)
- [Hvigor 命令行构建示例](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V14/ide-hvigor-compilation-options-customizing-sample-V14)
- [HarmonyOS 命令行录屏](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-screen-recording)

## 3. 首版范围

### 3.1 MVP 工具

| 领域 | 工具 | 说明 |
| --- | --- | --- |
| 设备 | `harmony_devices` | 枚举 USB 真机，返回连接状态和脱敏设备标识 |
| 能力 | `harmony_capabilities` | 报告 hdc、uitest、截图、输入、控件树、OCR 等能力及降级原因 |
| 构建 | `harmony_build` | 运行 Hvigor，定位并验证目标 HAP |
| 安装 | `harmony_install` | 显式安装一个已验证 HAP；不自动卸载或清数据 |
| 启动 | `harmony_launch` | 启动明确的 bundle/ability |
| 应用 | `harmony_list_apps` | 列出已安装应用，优先返回 bundle 信息 |
| 画面 | `harmony_screenshot` | 截取当前真机画面，返回受控本地路径和展示元数据 |
| 操作 | `harmony_interact` | tap、doubleTap、longPress、swipe、drag、text、Back、Home |
| 日志 | `harmony_logs` | 按 bundle/PID 过滤 HiLog，支持快照和有界 follow |
| OCR | `harmony_find_text` | 本地 OCR 当前屏幕，返回文本和矩形 |
| OCR | `harmony_tap_text` | 唯一匹配文本后点击，并支持结果断言 |
| 等待 | `harmony_wait_for` | 在工具内部轮询文本出现或消失 |

### 3.2 探针通过后启用

- `harmony_ui_tree`
- `harmony_tap_element`
- `harmony_ui_rows`
- `harmony_tap_row`
- `harmony_app_info`
- `harmony_processes`

### 3.3 首版明确不做

- 模拟器和无线 HDC。
- 任意 shell、任意设备文件系统访问。
- 自动授权、自动解锁、自动卸载、自动清数据。
- 15/30 FPS 视频流或把 MP4 录屏伪装成实时流。
- 自动安装 Accessibility/helper HAP。
- SwiftUI Preview 对应物、热重载、backtrace、leaks、hitrace、hiperf、heap 分析。
- 未经确认的支付、消息发送、发布、点赞等真实账号操作。

## 4. 架构边界

```text
DSH Agent Tools
      |
      v
Tool factories / schemas / result limits
      |
      v
Per-device serialized session
      |---------------------|---------------------|
      v                     v                     v
HDC + UiTest backend    Hvigor/App backend    OCR backend
      |                     |                     |
      v                     v                     v
USB retail device       Build/install/AA      Local image OCR

Frame producer -> latest-frame cache -> signed loopback routes -> React sidebar
```

### 4.1 从 dsh-ios 适配

- Cordis 生命周期和工具注册模式。
- `presentationMeta` 与 Code Mode 结果恢复思路。
- HMAC capability、loopback/Host/Origin 防护和截图路径隔离。
- 侧栏、工具卡、状态胶囊、设备选择器和尺寸控制交互。
- OCR 目标选择、等待、列表行抽象的纯算法部分。
- 复用 MIT 代码时保留原许可证和归属说明。

### 4.2 必须重写

- `simctl`、`devicectl`、WDA、usbmux、serve-sim 等 iOS 后端。
- Xcode/Swift Package 构建逻辑。
- iOS Accessibility/AXe/WDA UI tree 解析。
- iOS 进程、日志和调试命令。

## 5. 全局不变量

以下约束对每一个工作包都有效：

1. 所有真机命令都必须带 `hdc -t <connect-key>`；多设备时不允许默认选第一台。
2. MVP 只接受 `list targets -v` 确认为 USB 且 Connected 的设备。
3. 不提供任意 shell 工具；进程执行使用参数数组，禁止 `shell: true` 和字符串拼接命令。
4. UiTest 调用按设备串行，截图轮询使用 latest-frame-wins，不积压任务。
5. Agent 发起坐标操作必须引用 `frameId + orientation + dimensions`；陈旧帧或旋转后拒绝执行。
6. 元素和 OCR 匹配存在歧义时拒绝点击，禁止用点击“试探”未知控件。
7. 前台 bundle 未知、设备锁屏或进入系统敏感界面时，Agent 自动操作默认拒绝。
8. 原始设备序列号只存在于 host 进程内；UI、工具结果和日志使用哈希或脱敏标识。
9. 截图、UI tree、OCR、HiLog 和构建输出均设置字节/行数上限。
10. 浏览器永远不直接连接 HDC 或设备端口；只访问插件拥有的同源签名路由。
11. 签名冲突不触发自动卸载；安装替换必须是显式参数。
12. 每个工具始终注册；能力缺失时返回结构化 `available:false` 和可执行提示。

## 6. 依赖图与并行机会

```text
WP0 可行性与支持契约
  -> WP1 插件骨架
    -> WP2 HDC 核心
      -> WP3 构建/安装/启动/日志 ----|
      -> WP4 截图与基础交互 ---------|--> WP8 真机 E2E 与发布
                |                     |
                +-> WP5 安全路由 -> WP6 侧栏
                |
                +-> WP7 OCR 与语义 UI
```

- WP3 与 WP4 可在 WP2 完成后并行。
- WP5 与 WP7 可在 WP4 的截图接口稳定后并行。
- WP6 依赖 WP5；不能在安全路由前向浏览器暴露截图。
- WP8 依赖 WP3、WP6、WP7，但真机回归用例必须随每个工作包持续增加，不能全部推迟到最后。

## 7. 工作包

### WP0：支持契约、威胁模型与真机探针

**建议分支：** `codex/wp0-device-feasibility`  
**依赖：** 无  
**模型等级：** 强模型；需要平台判断和 go/no-go 决策  
**预计：** 2–3 天，需要至少一台目标零售真机；发布前需两台不同 API 版本真机

#### 冷启动上下文

仓库为空，不能假设零售 HarmonyOS 真机完整支持 OpenHarmony README 中的 shell UiTest 命令。截图与输入是整个产品的硬门；UI tree 可以降级；实时预览帧率必须先测量。

#### 交付物

- `docs/support-contract.md`
- `docs/threat-model.md`
- `scripts/probe-device.mjs`
- `fixtures/probes/<uitest-version>/`
- 一份选择截图后端和交互后端的 ADR

#### 任务

1. 记录 host OS、Node、DevEco Studio、SDK、HDC、设备系统/API 和 UiTest 版本。
2. 探测 `hdc list targets -v`、USB/授权状态和结构化失败形式。
3. 探测 `uitest screenCap`、`dumpLayout`、`uiInput`、`--version`。
4. 对 100 次截图、30 次点击、10 次滑动、10 次输入做耗时和成功率统计。
5. 检查中文输入、锁屏、旋转、权限弹窗、系统窗口、隐私窗口和断连行为。
6. 测量截图轮询的稳定 FPS、CPU、带宽和点击到新画面的延迟。
7. 输出机器可读 capabilities；禁止依赖可变错误文本做唯一判断。

#### 验证

```bash
node scripts/probe-device.mjs --list
node scripts/probe-device.mjs --device <redacted-device-id> --all
node scripts/probe-device.mjs --device <redacted-device-id> --soak 100
```

#### 退出条件

- 截图与输入在未 Root 零售真机上稳定工作，否则项目停止并评估 helper HAP。
- UI tree 明确标记为 enabled 或 degraded，失败不阻塞截图/OCR MVP。
- 实时预览后端已选定，目标定义为 0.5–2 FPS 自适应预览。
- 支持矩阵、威胁模型和能力 JSON 已审阅。

#### 回滚/降级

- `dumpLayout` 不可靠：关闭 UI tree capability，保留截图 + OCR。
- `uiInput` 版本过旧：将完整交互最低要求定为 UiTest ≥4.1.2，不向设备推送自编译系统二进制。
- 截图低于 0.5 FPS：侧栏改为按需刷新；helper HAP 单独立项评审。

---

### WP1：插件骨架、测试框架与稳定协议

**建议分支：** `codex/wp1-plugin-scaffold`  
**依赖：** WP0  
**模型等级：** 默认  
**预计：** 1–2 天

#### 冷启动上下文

使用 TypeScript ESM 和 Cordis/DSH peer dependencies，结构参考 dsh-ios，但包名、工具前缀和展示协议使用 Harmony 命名。所有工具必须无设备时也能注册。

#### 预期文件

- `package.json`、`pnpm-lock.yaml`
- `tsconfig.json`、`tsconfig.client.json`
- `cordis.patch.yml`
- `src/index.ts`
- `src/protocol.ts`
- `src/client/index.tsx`
- `scripts/build-client.mjs`
- `test/fixtures/`

#### 任务

1. 建立 `@zseven-w/dsh-harmony` 包和 `dsh-harmony` 插件 id。
2. 固定 DSH/Cordis peer 范围并记录兼容基线。
3. 建立 host/client 双构建、类型检查、测试和 smoke 脚本。
4. 定义工具公共结果、设备引用、结构化错误和 presentation meta 协议。
5. 注册 `harmony_capabilities` 占位工具和内置技能接口。
6. 增加 MIT/third-party notice 机制。

#### 验证

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

#### 退出条件

- 空设备环境能加载和卸载插件，无残留 effect。
- host/client 都能构建。
- 工具 schema 和错误协议有快照测试。
- 包中不包含 iOS 产品命名或模拟器假设。

#### 回滚

删除 WP1 新增文件即可回到空仓库；不要在该步骤引入设备后端。

---

### WP2：HDC 核心、能力探测与设备会话

**建议分支：** `codex/wp2-hdc-core`  
**依赖：** WP1  
**模型等级：** 强模型；涉及进程、安全和状态机  
**预计：** 2–3 天

#### 冷启动上下文

HDC 是唯一设备传输层。实现必须支持 PATH、环境变量和 DevEco Studio SDK 查找，并在多设备、未授权、断连和超时情况下给出结构化结果。

#### 预期文件

- `src/hdc/resolve.ts`
- `src/hdc/client.ts`
- `src/hdc/devices.ts`
- `src/hdc/errors.ts`
- `src/device-session.ts`
- `src/capabilities.ts`
- `src/tools/device-tools.ts`

#### 任务

1. 解析 HDC 路径和版本，不使用 shell。
2. 实现可取消的 `spawn` 执行器：超时、输出上限、退出码、signal、子进程回收。
3. 解析 `list targets -v`，区分 USB/TCP 和 Connected/Unauthorized/Offline。
4. 建立每设备互斥队列、断连状态机和生命周期清理。
5. 计算只用于展示的 device hash，严禁泄露 connect-key。
6. 实现 `harmony_devices`、`harmony_capabilities`。
7. 使用 probe fixtures 覆盖不同 HDC/UiTest 输出。

#### 验证

```bash
pnpm test -- hdc
pnpm test -- device-session
node scripts/run-tool.mjs harmony_devices '{}'
node scripts/run-tool.mjs harmony_capabilities '{}'
```

#### 退出条件

- 多设备时，未传 device 参数的写操作被拒绝。
- TCP/Wi-Fi target 在 MVP 被拒绝。
- 未授权、离线、拔线和命令超时均是结构化错误。
- 插件卸载后没有 HDC 子进程或等待队列。

#### 回滚

能力工具可退回 `available:false`，不影响插件加载；不得退回到字符串 shell 命令。

---

### WP3：构建、安装、启动、应用信息与日志

**建议分支：** `codex/wp3-app-dev-loop`  
**依赖：** WP2  
**可与：** WP4 并行  
**模型等级：** 默认  
**预计：** 3–4 天

#### 冷启动上下文

目标是源代码到真机的最小开发闭环。Harmony 项目可能有多个 module/product/target；不能猜测 entry/default，也不能在签名冲突时自动卸载用户应用。

#### 预期文件

- `src/build/project.ts`
- `src/build/hvigor.ts`
- `src/build/artifacts.ts`
- `src/apps/bundle-manager.ts`
- `src/apps/ability-assistant.ts`
- `src/logs/hilog.ts`
- `src/tools/app-tools.ts`

#### 任务

1. 解析 JSON5 工程配置并列出 module/product/buildMode 候选。
2. 解析项目本地 Hvigor wrapper，必要时查找 DevEco 工具。
3. 运行 `assembleHap`，过滤和限制构建错误输出。
4. 定位唯一 artifact；歧义时返回候选，不猜测。
5. 验证 HAP、bundle、ability 和签名元数据。
6. 实现显式安装；`replace` 默认 false；不使用高危 grant/uninstall/clean。
7. 通过 `aa start` 启动明确 ability。
8. 实现应用列表和按 bundle/PID 过滤的 HiLog snapshot/follow。

#### 验证

```bash
pnpm test -- build
pnpm test -- apps
pnpm test -- hilog
node scripts/run-tool.mjs harmony_build '{"projectPath":"<fixture>"}'
node scripts/run-tool.mjs harmony_logs '{"device":"<id>","bundle":"com.example.app"}'
```

真机验证：

```text
build -> install -> launch -> filtered logs
```

#### 退出条件

- 单一 HAP 工程完整闭环成功。
- module/product/ability 歧义不会触发隐式选择。
- 签名冲突不会自动卸载或清数据。
- HiLog 默认不采集整机日志，单次输出 ≤30 KB。
- 构建日志不含证书密码或敏感路径内容。

#### 回滚

各工具可独立关闭 capability；保留已安装应用，不执行回滚卸载。

---

### WP4：截图、帧身份与基础交互

**建议分支：** `codex/wp4-screen-input`  
**依赖：** WP2  
**可与：** WP3 并行  
**模型等级：** 强模型；涉及坐标正确性和真机安全  
**预计：** 3–4 天

#### 冷启动上下文

使用 WP0 选定的 `uitest screenCap` 或等价后端截图，以 `uiInput` 注入动作。截图是 Agent 和侧栏共同的事实源；交互坐标必须绑定画面版本，防止旋转或 UI 变化后的陈旧点击。

#### 预期文件

- `src/screen/capture.ts`
- `src/screen/frame-store.ts`
- `src/screen/png.ts`
- `src/input/uitest.ts`
- `src/input/coordinates.ts`
- `src/tools/visual-tools.ts`

#### 任务

1. 截图到插件专用远端临时路径，再安全拉取到本地缓存。
2. 解析 PNG 尺寸、方向和时间戳，生成单调 `frameId`。
3. 实现 `harmony_screenshot` 与 presentation meta。
4. 实现 tap/doubleTap/longPress/swipe/drag/text/Back/Home。
5. 坐标采用标准化 0..1 输入，在执行前映射到当前帧像素。
6. Agent 坐标写操作要求 frame identity；用户在面板上的直接手势单独标记为 user gesture。
7. 加入前台 bundle、锁屏和敏感系统界面安全检查。
8. 命令完成后按需获取新帧，不固定 sleep 后盲目成功。

#### 验证

```bash
pnpm test -- screen
pnpm test -- input
node scripts/run-tool.mjs harmony_screenshot '{"device":"<id>"}'
node scripts/run-tool.mjs harmony_interact '{"device":"<id>","action":"tap","x":0.5,"y":0.5,"frameId":"<id>"}'
```

#### 退出条件

- 截图尺寸、旋转和坐标映射在竖屏/横屏正确。
- 陈旧 frame、错误方向、越界坐标和歧义设备均拒绝执行。
- 用户断开 USB 后 5 秒内结束截图/输入任务。
- 100 次截图和 30 次动作满足 WP0 设定的成功率阈值。

#### 回滚

保留截图，关闭写操作 capability；不能为了兼容而绕过 frame 校验。

---

### WP5：安全 Web 路由与共享帧缓存

**建议分支：** `codex/wp5-secure-stream-routes`  
**依赖：** WP4  
**可与：** WP7 并行  
**模型等级：** 强模型；安全关键  
**预计：** 3–4 天

#### 冷启动上下文

浏览器只允许通过 DSH webserver 的插件同源路由访问画面和控制。安全层必须先于侧栏，参考 dsh-ios 的 HMAC capability 与 transport fence，并增加长连接过期、控制序列和限频。

#### 预期文件

- `src/web/access.ts`
- `src/web/fence.ts`
- `src/web/frame-producer.ts`
- `src/web/routes.ts`
- `src/web/control.ts`

#### 任务

1. 实现 `/grant`、`/stream`、`/screenshot`、`/control`、`/capture`、`/devices`、`/status`。
2. HMAC token 绑定 version、session、device hash、action、expiry。
3. 分离 screenshot、stream、control capability。
4. 校验 loopback peer、Host、Origin 和 Fetch-Metadata，拒绝 DNS rebinding。
5. 长连接到期主动关闭；控制请求加入单调 sequence、防重放、大小限制和限频。
6. 缓存目录 0700、文件 0600、realpath containment、拒绝软链。
7. 使用一个设备级 frame producer 服务多个消费者；latest-frame-wins。
8. 无消费者 5 分钟停止，断连立即清理。
9. 响应设置 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`。

#### 验证

```bash
pnpm test -- web
pnpm test -- security
pnpm run test:routes
```

必须包含：

- 篡改、过期、跨 session token。
- 非 loopback、错误 Host/Origin。
- 路径穿越和软链。
- 控制重放、乱序和超大消息。
- 长连接 token 到期。

#### 退出条件

- 所有负向安全测试通过。
- 浏览器看不到真实 HDC 标识、设备端口、文件系统路径或 token 日志。
- 多消费者不会启动多个截图循环。
- 10 分钟运行无截图任务堆积。

#### 回滚

关闭可选 webServer scope 后，headless 工具仍可工作；不得绕过安全路由直接向浏览器暴露本地端口。

---

### WP6：React 实时预览侧栏

**建议分支：** `codex/wp6-live-sidebar`  
**依赖：** WP5  
**模型等级：** 默认  
**预计：** 4–5 天

#### 冷启动上下文

首版是 0.5–2 FPS 的自适应实时预览。客户端通过 `/grant` 获取短时 capability，不能保存永久 URL。可以适配 dsh-ios 的卡片、侧栏、状态胶囊、设备选择器和尺寸状态机，但要删除模拟器、WDA 和 iPhone 专属逻辑。

#### 预期文件

- `src/client/protocol.ts`
- `src/client/harmony-panel.tsx`
- `src/client/harmony-live-frame.tsx`
- `src/client/harmony-device-picker.tsx`
- `src/client/harmony-toolbar.tsx`
- `src/client/harmony-status-capsule.tsx`
- `src/client/meta-hydrate.ts`

#### 任务

1. 实现紧凑工具卡和“在侧栏打开”交互。
2. 实现持久侧栏和窄屏 overlay fallback。
3. 展示实时帧、当前设备、方向、FPS/降级状态和错误原因。
4. 点击映射为 tap，拖动映射为 swipe/drag；手势按频率采样。
5. 工具栏加入 Back、Home、截图、刷新、尺寸和框体样式。
6. 支持多设备选择，但用户切换不会自动授权 Agent 写操作。
7. 实现 session gating、状态胶囊和 Code Mode meta hydrate。
8. 自动重授权过期 token，设备断连时停止并显示可操作提示。

#### 验证

```bash
pnpm run typecheck
pnpm test -- client
pnpm run test:visual
pnpm run dev:panel-smoke
```

#### 退出条件

- 首帧 ≤3 秒，稳定刷新 ≥0.5 FPS，达不到时明确显示“低速预览”。
- 连续运行 10 分钟无帧任务堆积或内存持续增长。
- 点击/拖动在竖屏、横屏和缩放模式坐标正确。
- 切换 DSH session 后旧 session 的画面和控制能力不可访问。
- 组件异常不会拖垮整个会话 UI。

#### 回滚

禁用 client bundle 后，headless 工具保持可用；侧栏失败不能影响 Agent 工具注册。

---

### WP7：本地 OCR、等待和语义 UI

**建议分支：** `codex/wp7-semantic-ui`  
**依赖：** WP4；UI tree 部分还依赖 WP0 gate  
**可与：** WP5 并行  
**模型等级：** 强模型；涉及匹配和真实账号安全  
**预计：** 4–5 天

#### 冷启动上下文

默认观察顺序是 OCR 文本，再在能力可用时使用 UI tree 身份。OCR 必须离线。UiTest tree 输出随版本变化，需用 fixtures 归一化；匹配歧义时拒绝操作。

#### 预期文件

- `src/ocr/backend.ts`
- `src/ocr/targets.ts`
- `src/ui-tree/parser.ts`
- `src/ui-tree/normalize.ts`
- `src/ui-tree/targets.ts`
- `src/ui-tree/rows.ts`
- `src/tools/semantic-tools.ts`
- `src/skill.ts`

#### 任务

1. 建立可插拔 OCR backend；MVP 在 macOS 使用本地 Vision，其他 host 明确降级。
2. 实现截图坐标与 OCR 像素矩形转换。
3. 实现 exact → case-insensitive → unique contains 目标解析。
4. 实现 find/tap/wait，tap 支持 `expect_text` 与 `expect_gone`。
5. 解析 `dumpLayout` JSON，统一 text/id/type/bounds/enabled/visible/hint/description。
6. UI tree 限深、裁剪屏外节点并限制结果 ≤40 KB。
7. 实现元素唯一匹配、中心点点击和动作后断言。
8. 探针证明列表结构稳定后，再实现 rows 与 count-change 校验。
9. 注册 `harmony-ui-automation` 技能，规定 observe → act with assertion → observe only if needed。

#### 验证

```bash
pnpm test -- ocr
pnpm test -- ui-tree
pnpm test -- semantic-tools
node scripts/run-tool.mjs harmony_find_text '{"device":"<id>","query":"确定"}'
node scripts/run-tool.mjs harmony_ui_tree '{"device":"<id>"}'
```

#### 退出条件

- 中文、英文和混合文本 fixture 匹配正确。
- 多个候选时 tap 工具拒绝执行并列出候选。
- UI tree 若启用：p95 ≤3 秒、结果 ≤40 KB；不达标则 capability 关闭。
- tap + assertion 可以在一个工具调用中确认页面变化。
- 屏幕内容不会上传到外部 OCR 服务。

#### 回滚/降级

- OCR backend 不可用：保留 screenshot，`available:false`。
- UI tree 不稳定：关闭 tree/element/row 工具，保留 OCR。
- 不允许通过安装跨应用 Accessibility helper 来绕过限制。

---

### WP8：持续真机 E2E、文档、发布与 v0.1 冻结

**建议分支：** `codex/wp8-release-hardening`  
**依赖：** WP3、WP6、WP7  
**模型等级：** 强模型；发布与风险审查  
**预计：** 4–6 天

#### 冷启动上下文

发布标准不是工具数量与 iOS 版完全一致，而是核心开发闭环在不同零售真机上可重复、可恢复且不会误操作。高级性能工具留给 v0.2。

#### 预期文件

- `e2e/fixture-app/`
- `e2e/device-matrix.json`
- `scripts/e2e-device.mjs`
- `.github/workflows/check.yml`
- `.github/workflows/release.yml`
- `README.md`、`README.zh.md`
- `THIRD_PARTY_NOTICES.md`
- `CHANGELOG.md`

#### 任务

1. 创建确定性测试 HAP：按钮、输入框、列表、计数器、旋转和权限场景。
2. 在两台不同 API 版本未 Root 零售真机运行全闭环。
3. 覆盖未授权、锁屏、多设备、拔线、重连、慢设备和隐私窗口。
4. 对每个安全不变量建立回归测试。
5. 完成中英文安装、USB 授权、签名、能力矩阵和故障排查文档。
6. 检查 npm 包内容、license、source map、secret 和体积。
7. 建立 RC 发布流程和 DSH 兼容矩阵。
8. 冻结工具 schema；破坏性变更只能进入下一主版本或 RC 重置。

#### 验证

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run test:visual
node scripts/e2e-device.mjs --device <device-a> --repeat 3
node scripts/e2e-device.mjs --device <device-b> --repeat 3
pnpm pack --dry-run
```

每台真机必须连续三次跑通：

```text
discover -> build -> install -> launch -> screenshot
-> OCR/element locate -> tap with assertion -> filtered logs
```

#### 退出条件

- 两台不同 API 真机完整流程各连续成功三次。
- 未授权、锁屏、多设备、拔线和重连均返回结构化错误，无误选设备和挂死进程。
- 侧栏首帧、刷新、10 分钟稳定性达到 WP6 门槛。
- 全部安全负向测试通过。
- 日志中不含设备序列号、证书密码、HMAC token 或完整敏感屏幕文本。
- npm 包可在干净 DSH profile 中安装、加载、卸载。

#### 回滚

RC 发布失败时撤回 npm dist-tag，不改写已发布版本；保留 git tag 和失败报告。插件卸载不删除用户应用或项目构建产物。

## 8. 分支、PR 与 CI 协议

1. 在建立首个基线提交后，每个工作包使用独立 `codex/wpN-*` 分支。
2. 每个 PR 只实现一个工作包；如超过可审查规模，按后端/工具/测试拆分子 PR。
3. PR 描述必须包含：支持矩阵变化、威胁模型影响、真实设备证据、回滚方式。
4. 无真机的 CI 运行 fixture、unit、contract、route-security 和 client tests。
5. 真机 E2E 为受控发布 gate，不把设备标识或截图上传到公共 CI artifact。
6. 合并前保持 `typecheck + unit + build + security` 全绿。

## 9. 计划变更协议

计划不是不可修改，但所有修改必须留下记录。

### 9.1 允许的变化

- **拆分：** 工作包过大时拆成 `WPx.a/WPx.b`，保持原退出条件归属明确。
- **插入：** 发现新的硬依赖时插入工作包，并更新依赖图。
- **重排：** 只有文件冲突和产物依赖允许时才能并行或重排。
- **跳过：** 仅限 capability 被明确降级，且不违反全局不变量。
- **放弃：** 可行性门失败时停止相关方向，不允许用未评审 helper 或私有协议偷偷替代。

### 9.2 变更记录模板

| 日期 | 变更 | 证据 | 依赖影响 | 验收影响 | 决策人 |
| --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | 示例：关闭 UI tree capability | 两台零售机 dump p95 > 8s | WP7 降级 | OCR 成为唯一语义后端 | — |

### 9.3 不可弱化项

- 不得为了进度取消显式设备选择、frame identity 或歧义拒绝。
- 不得绕过 loopback/HMAC 路由。
- 不得新增任意 shell。
- 不得自动卸载、清数据或绕过设备安全限制。
- 不得把真实设备内容发送到未明确批准的外部服务。

## 10. 对抗性审查记录

计划在 2026-08-27 完成一次独立对抗性审查，原草案据此做了以下关键调整：

1. 把 UI tree 从“确定后端”改成可降级 capability。
2. 把实时侧栏从普通实现项改成带性能门的截图预览方案。
3. 明确 USB-only、多设备显式选择、frame identity 和真实账号安全边界。
4. 把安全 Web 路由提前到侧栏之前。
5. 拆分构建、安装、启动，并禁止签名冲突时自动卸载。
6. 将高级性能/调试工具移出 v0.1，优先确保核心开发闭环。

## 11. 粗略工期

| 阶段 | 单人预计 |
| --- | ---: |
| WP0 可行性探针 | 2–3 天 |
| WP1–WP4 headless MVP | 8–12 天 |
| WP5–WP7 安全侧栏与语义操作 | 10–14 天 |
| WP8 真机加固与发布 | 4–6 天 |
| 合计 | 约 5–6 周 |

如果 WP0 证明截图预览或 shell UI 输入在目标零售设备上不可用，需要另立 helper HAP/投屏协议设计评审，工期不包含在上述估算内。
