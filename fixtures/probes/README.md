# Probe fixtures

此目录保存经过脱敏的 HDC/UiTest 探针输出，用于版本兼容回归。

要求：

- 不提交原始 connect-key、账号、截图或完整控件树。
- 设备 id 替换为不可逆摘要或固定测试值。
- 控件树只保留验证解析器所需的最小结构，删除可识别文本。
- 每个 fixture 目录记录 HDC、UiTest、HarmonyOS/API 和设备类型，不记录序列号。

已添加首台真机的聚合能力 fixture；它不包含原始命令输出、截图、控件树或设备 connect-key。
