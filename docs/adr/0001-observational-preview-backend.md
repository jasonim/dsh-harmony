# ADR-0001：先验证 UiTest 截图轮询，再决定实时预览后端

- 状态：Confirmed for v0.1 read-only preview；输入反馈延迟 Pending
- 日期：2026-08-27

## 背景

dsh-ios 使用 serve-sim/WDA MJPEG 提供实时画面。HarmonyOS 官方命令行录屏输出完成后的 MP4，没有公开、稳定、面向插件的低延迟 HDC 视频流接口。OpenHarmony UiTest 提供 `screenCap`、`dumpLayout` 和 `uiInput`，但零售设备的可用性和性能必须实测。

## 决策

1. v0.1 首选 `uitest screenCap` 轮询。
2. 每台设备只允许一个帧生产者。
3. latest-frame-wins，不排队积压帧。
4. 目标定义为 0.5–2 FPS 的“实时预览”，不称为视频流。
5. 用户交互优先于下一次截图。
6. `dumpLayout` 与截图串行，因为 UiTest 不支持并发调用。
7. 如果稳定刷新低于 0.5 FPS，侧栏降级为按需刷新。
8. helper HAP、AVScreenCapture、DevEco 私有投屏协议均不在 v0.1 自动启用；需要独立安全与授权评审。

## 选择理由

- 依赖官方、可探测的设备命令。
- 不安装额外跨应用辅助服务。
- 不要求 Root 或替换系统二进制。
- 能复用 dsh-ios 的同源签名路由和 React 侧栏结构。
- 即使 UI tree 不可用，截图 + 本地 OCR 仍能保留核心价值。

## 代价

- 帧率明显低于 MJPEG/H.264。
- 每帧包含远端落盘、HDC 拉取和本地读取开销。
- 交互后的画面反馈延迟必须通过 soak 测量。
- 断线时远端临时文件清理只能 best-effort。

## 验证要求

在至少两台不同 API 版本未 Root 零售真机上记录：

- 100 次截图成功率。
- min/mean/p50/p95/max 耗时。
- 连续 10 分钟是否积压。
- 点击到新画面可见的 p95 延迟。
- CPU、带宽和设备温升的定性结果。

## 后续决策

真机探针完成后更新本 ADR：

- `Confirmed`：截图轮询满足 v0.1。
- `Degraded`：只支持按需刷新。
- `Superseded`：另一个经过安全评审的后端替代。

## 2026-08-27 验证结果

首台 USB 零售真机的 UiTest 版本为 6.0.2.3。截图与控件树均可用；100 次串行截图全部成功，mean 1062.37 ms、p95 1131.13 ms、max 1214.19 ms，对应约 0.94 FPS。该结果确认截图轮询可作为 v0.1 只读预览后端，且应继续采用 latest-frame-wins 和单生产者约束。

此结论尚不覆盖第二台 API 版本不同的设备、10 分钟连续运行、设备温升，也不覆盖点击到新画面可见的延迟。这些项目仍是进入完整交互 MVP 前的验收项。
