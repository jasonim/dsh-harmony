/** Stable loader id used by the DSH host and browser bundle. */
export const PLUGIN_NAME = 'dsh-harmony'

/** Public v0.1 tool names in registration order. */
export const HARMONY_TOOL_NAMES = [
  'harmony_devices',
  'harmony_capabilities',
  'harmony_build',
  'harmony_install',
  'harmony_launch',
  'harmony_list_apps',
  'harmony_screenshot',
  'harmony_interact',
  'harmony_logs',
  'harmony_find_text',
  'harmony_tap_text',
  'harmony_wait_for',
  'harmony_ui_tree',
  'harmony_tap_element',
  'harmony_ui_rows',
  'harmony_tap_row',
  'harmony_app_info',
  'harmony_processes',
] as const

export type HarmonyToolName = typeof HARMONY_TOOL_NAMES[number]
