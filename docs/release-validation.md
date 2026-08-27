# DSH Harmony 0.1.0-rc.1 发布验证

> 日期：2026-08-27

## 已通过

- 18 个 DSH tools 的 schema、注册、执行分派与卸载生命周期。
- HDC 真机枚举、脱敏设备 id、USB + Connected gate、所有设备命令显式
  `-t`、同设备串行执行、超时与输出上限。
- UiTest PNG 截图、frameId 陈旧帧拒绝、控件树解析、歧义元素拒绝、语义
  列表行和 OCR。
- HMAC capability、十分钟上限、loopback peer/Host、Origin/Fetch-Metadata、
  截图目录与 symlink 防护。
- React 右侧栏、约 1100 ms 截图轮询、点击/拖动、Back/Home、过期
  capability 自动续期。
- 确定性 HarmonyOS 测试 HAP 通过当前 DevEco SDK/Hvigor 的真实编译；
  插件 `harmony_build` 路径在不预设 `NODE_HOME`/`DEVECO_SDK_HOME` 时也通过。
- 93/93 自动化测试通过；总行覆盖率 84.43%，函数覆盖率 81.78%。
- host/client 正式构建通过；npm tarball 包含 host、client、OCR Swift source、
  内置技能、MIT 许可证和上游 notice。
- tarball 已安装到 DSH web profile；最终候选启动于随机 loopback 端口，根
  页面返回 200，插件 `/grant` 对无效请求返回受控 400，随后正常关闭。

## 尚待外部条件

真机只读探针确认一台 `USB + Connected` 零售设备。通用 OpenHarmony
证书签出的测试 HAP 被该设备拒绝，系统返回 `fail to verify pkcs7 file`。
因此确定性安全门没有进入任何输入循环，30 clicks / 10 swipes / 10 text
inputs / Back 仍未取得真机证据。

需要用开发者自己的 HarmonyOS 调试签名构建 `fixtures/harness-app`，然后运行：

```bash
node scripts/device-input-gate.mjs --hap /absolute/path/to/signed.hap
```

脚本会验证安装和 ability 命令的语义结果，并在控件树确认固定 bundle 位于
前台之前拒绝任何输入。
