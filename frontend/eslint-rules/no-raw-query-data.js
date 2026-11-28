// ClickUp 14yq6g334bn: a screen that maps `query.data` itself keeps showing stale items under the error after a refresh
// fails with 401, 403 or 404 (src/api/queryState.ts: hasData is false then, but TanStack Query still holds the data).
// For every identifier the file passes to a load-state helper (loadFailed, refreshFailed, hasData, shownData), this
// rule reports a `<id>.data` read unless it sits inside a guard that proves there is data to show:
//   hasData(q) && q.data.x, hasData(q) ? q.data.x : …, if (hasData(q)) { … q.data … }, refreshFailed(q) && …,
//   or after an early `if (!hasData(q)) return …` in the same block. Anything else reads `shownData(q)`.
// It knows identifiers only (a query passed as `props.query` is not tracked), which covers the screens in src.

const HELPERS = new Set(['loadFailed', 'refreshFailed', 'hasData', 'shownData'])
const GUARDS = new Set(['hasData', 'refreshFailed'])

function helperArg(node, names) {
  return node?.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    names.has(node.callee.name) &&
    node.arguments[0]?.type === 'Identifier'
    ? node.arguments[0].name
    : null
}

/** The test proves `name` has data: a guard call, or an && chain holding one. */
function proves(test, name) {
  if (!test) return false
  if (helperArg(test, GUARDS) === name) return true
  return test.type === 'LogicalExpression' && test.operator === '&&'
    ? proves(test.left, name) || proves(test.right, name)
    : false
}

/** The test proves `name` has NO data (`!hasData(q)`, or an || chain holding it): an early exit on it guards the rest. */
function refutes(test, name) {
  if (!test) return false
  if (test.type === 'UnaryExpression' && test.operator === '!') return proves(test.argument, name)
  return test.type === 'LogicalExpression' && test.operator === '||'
    ? refutes(test.left, name) || refutes(test.right, name)
    : false
}

function exits(statement) {
  if (!statement) return false
  if (statement.type === 'ReturnStatement' || statement.type === 'ThrowStatement') return true
  return statement.type === 'BlockStatement' && exits(statement.body.at(-1))
}

function guarded(node, name) {
  let child = node
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (parent.type === 'LogicalExpression' && parent.operator === '&&' && parent.right === child) {
      if (proves(parent.left, name)) return true
    }
    if (
      (parent.type === 'ConditionalExpression' || parent.type === 'IfStatement') &&
      parent.consequent === child &&
      proves(parent.test, name)
    ) {
      return true
    }
    if (parent.type === 'BlockStatement' || parent.type === 'Program') {
      for (const statement of parent.body) {
        if (statement === child) break
        if (
          statement.type === 'IfStatement' &&
          refutes(statement.test, name) &&
          exits(statement.consequent)
        ) {
          return true
        }
      }
    }
  }
  return false
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Render a query with load state from shownData or under a hasData guard' },
    messages: {
      raw: '{{name}}.data still holds stale items after a 401/403/404 refresh: read shownData({{name}}) from src/api/queryState.ts, or read it under a hasData({{name}}) guard.',
    },
    schema: [],
  },
  create(context) {
    const tracked = new Set()
    const reads = []
    return {
      CallExpression(node) {
        const name = helperArg(node, HELPERS)
        if (name) tracked.add(name)
      },
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          !node.computed &&
          node.property.type === 'Identifier' &&
          node.property.name === 'data'
        ) {
          reads.push(node)
        }
      },
      'Program:exit'() {
        for (const node of reads) {
          const name = node.object.name
          if (tracked.has(name) && !guarded(node, name)) {
            context.report({ node, messageId: 'raw', data: { name } })
          }
        }
      },
    }
  },
}
