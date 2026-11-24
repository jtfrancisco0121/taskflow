import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BIG_LIST,
  STRUCTURE,
  assigneeIndexFor,
  commentText,
  doc,
  dueDateFor,
  hasComment,
  hasSubtask,
  keyFor,
  priorityFor,
  statusIndexFor,
  subtaskTitle,
  tagsFor,
  taskTitle,
  textOf,
} from './data.mjs'

test('the same index always gives the same task, so a re-run finds it by title', () => {
  for (let i = 0; i < 200; i++) {
    assert.equal(taskTitle('Bugs', i), taskTitle('Bugs', i))
    assert.equal(dueDateFor(i), dueDateFor(i))
    assert.deepEqual(tagsFor(i), tagsFor(i))
  }
  assert.equal(taskTitle('Bugs', 0), 'Draft onboarding flow (Bugs #1)')
})

test('titles are unique inside a List, including the big one', () => {
  const titles = new Set()
  for (let i = 0; i < BIG_LIST.count; i++) titles.add(taskTitle(BIG_LIST.list, i))
  assert.equal(titles.size, BIG_LIST.count)
})

test('a few hundred demo tasks over three Spaces, with every field varied', () => {
  const lists = STRUCTURE.flatMap((s) => [...s.lists, ...s.folders.flatMap((f) => f.lists)])
  const total = lists.reduce((n, l) => n + l.tasks, 0)
  assert.ok(total >= 200 && total <= 400, `total ${total}`)
  assert.equal(STRUCTURE.length, 3)
  const priorities = new Set(Array.from({ length: 30 }, (_, i) => priorityFor(i)))
  assert.ok(priorities.size >= 4)
  assert.equal(new Set(Array.from({ length: 30 }, (_, i) => statusIndexFor(i))).size, 3)
  assert.ok(Array.from({ length: 30 }, (_, i) => assigneeIndexFor(i, 3)).includes(-1))
  assert.ok(Array.from({ length: 30 }, (_, i) => dueDateFor(i)).includes(undefined))
  assert.ok(Array.from({ length: 30 }, (_, i) => hasSubtask(i)).some(Boolean))
  assert.ok(Array.from({ length: 30 }, (_, i) => hasComment(i)).some(Boolean))
})

test('due dates are UTC midnights; a comment body round-trips through its text', () => {
  assert.match(dueDateFor(1), /^\d{4}-\d{2}-\d{2}T00:00:00Z$/)
  assert.equal(textOf(doc(commentText('X'))), 'Kickoff note: X')
  assert.equal(subtaskTitle('A'), 'A - checklist')
})

test('idempotency keys are stable per entity', () => {
  assert.equal(keyFor('task', 'Bugs', 3), keyFor('task', 'Bugs', 3))
  assert.notEqual(keyFor('task', 'Bugs', 3), keyFor('task', 'Bugs', 4))
})
