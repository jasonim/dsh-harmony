---
name: dsh-harmony
description: Drive a USB-connected HarmonyOS phone through the DSH Harmony tools, using frame-bound coordinates, UI identity, or OCR safely.
---

# DSH Harmony device operation

Use this skill only for a HarmonyOS device that the user has connected and
authorized over USB. The plugin does not support simulators, Wi-Fi HDC, root
workarounds, arbitrary shell commands, automatic uninstall, or data clearing.

## Start with capabilities

1. Call `harmony_devices` and select a device whose transport is USB and whose
   state is Connected. When multiple devices are present, pass its redacted id
   explicitly on every call.
2. Call `harmony_capabilities` before depending on UiTest tree, input, or OCR.
3. To deploy an app, call `harmony_build`, then explicitly pass its HAP path to
   `harmony_install`; use `harmony_launch` with a known bundle and ability.

## Prefer semantic targets

Use `harmony_ui_tree` plus `harmony_tap_element` for accessibility/resource
identity. Use `harmony_ui_rows` and `harmony_tap_row` for visible repeated rows.
When the tree cannot see rendered text, use `harmony_find_text` and
`harmony_tap_text`. If any identity or OCR query is ambiguous, stop and refine
the query; never choose a candidate by guessing.

## Coordinate safety

Call `harmony_screenshot` immediately before coordinate input. Every tap,
double-tap, long press, drag, or scroll must use the current `frameId` and
normalized coordinates from that same frame. A stale `frameId`, rotation, or
dimension change requires a new screenshot. After a write, inspect the returned
effect frame or use `harmony_wait_for` to verify the expected state.

## Sensitive actions

Do not operate payment, messaging, account, publishing, deletion, permission,
or system-security screens without the user's explicit instruction for that
specific action. If the foreground app is unknown, the device is locked, or a
permission/system overlay appears, stop and report it.

