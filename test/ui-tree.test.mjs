import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const TREE = {
  attributes: { bounds: '[0,0][1260,2720]' },
  children: [
    {
      attributes: {
        id: 'submit',
        accessibilityId: 'submit-button',
        type: 'Button',
        text: '提交',
        description: 'Submit form',
        bounds: '[100,200][500,320]',
        enabled: 'true',
        clickable: 'true',
        visible: 'true',
      },
      children: [],
    },
    {
      attributes: {
        id: 'cancel',
        type: 'Button',
        text: '取消',
        bounds: '[520,200][920,320]',
        enabled: 'false',
        clickable: 'true',
        visible: 'true',
      },
      children: [],
    },
  ],
}

describe('Harmony UI tree', () => {
  test('flattens UiTest nodes into bounded public records', async () => {
    const { flattenUiTree } = await import('../src/ui-tree.ts')

    const result = flattenUiTree(TREE, { maxDepth: 8, maxNodes: 20 })

    assert.equal(result.nodes.length, 3)
    assert.deepEqual(result.nodes[1].bounds, { x: 100, y: 200, width: 400, height: 120 })
    assert.equal(result.nodes[1].enabled, true)
    assert.equal(result.nodes[2].enabled, false)
    assert.equal(result.truncated, false)
  })

  test('matches exact identity before substrings and refuses ambiguity', async () => {
    const { findUniqueNode, flattenUiTree } = await import('../src/ui-tree.ts')
    const nodes = flattenUiTree(TREE).nodes

    assert.equal(findUniqueNode(nodes, { resourceId: 'submit' }).id, 'submit')
    assert.equal(findUniqueNode(nodes, { text: '提交' }).accessibilityId, 'submit-button')
    assert.throws(
      () => findUniqueNode([...nodes, { ...nodes[1], id: 'submit-copy' }], { text: '提交' }),
      /ambiguous/u,
    )
  })

  test('refuses disabled, invisible, and zero-area targets', async () => {
    const { assertTappable, flattenUiTree } = await import('../src/ui-tree.ts')
    const nodes = flattenUiTree(TREE).nodes

    assert.doesNotThrow(() => assertTappable(nodes[1]))
    assert.throws(() => assertTappable(nodes[2]), /disabled/u)
    assert.throws(
      () => assertTappable({ ...nodes[1], bounds: { x: 0, y: 0, width: 0, height: 1 } }),
      /bounds/u,
    )
  })

  test('enforces depth and node limits', async () => {
    const { flattenUiTree } = await import('../src/ui-tree.ts')
    const result = flattenUiTree(TREE, { maxDepth: 0, maxNodes: 1 })

    assert.equal(result.nodes.length, 1)
    assert.equal(result.truncated, true)
  })

  test('extracts semantic rows and aggregates nested descendant labels', async () => {
    const { extractUiRows, flattenUiTree } = await import('../src/ui-tree.ts')
    const tree = {
      attributes: { type: 'Column', bounds: '[0,0][1000,2000]' },
      children: [{
        attributes: { type: 'List', scrollable: 'true', bounds: '[0,200][1000,1800]' },
        children: [
          {
            attributes: { type: 'ListItem', bounds: '[0,200][1000,400]' },
            children: [{ attributes: { type: 'Text', text: 'Alpha', bounds: '[20,220][400,280]' } }],
          },
          {
            attributes: { type: 'ListItem', bounds: '[0,400][1000,600]' },
            children: [{ attributes: { type: 'Text', text: 'Beta', description: 'Second', bounds: '[20,420][400,480]' } }],
          },
        ],
      }],
    }

    const rows = extractUiRows(flattenUiTree(tree).nodes)

    assert.equal(rows.length, 2)
    assert.equal(rows[0].label, 'Alpha')
    assert.equal(rows[1].label, 'Beta Second')
    assert.deepEqual(rows[1].bounds, { x: 0, y: 400, width: 1000, height: 200 })
  })
})
