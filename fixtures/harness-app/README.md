# Deterministic HarmonyOS input harness

This tiny HAP is the only target used by the repository's destructive UiTest
input gate. Its bundle is `com.deepseek.dsh.harness` and its main ability is
`EntryAbility`.

Build from this directory with the DevEco Studio Hvigor wrapper:

```bash
DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk \
  /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw \
  assembleHap --mode module -p module=entry@default -p product=default \
  --no-daemon --no-parallel
```

The device gate installs and opens this fixture, resolves targets from its
accessibility tree, then verifies 30 clicks, 10 swipes, and 10 text inputs.
Never run that gate against an unknown foreground application.
