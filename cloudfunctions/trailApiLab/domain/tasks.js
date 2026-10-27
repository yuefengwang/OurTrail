// 协作任务（V1）：活动内 checklist，不是跨活动工作流。
// 只有组织者写；参与者/协作者只读；不引入跨账号指派授权。
'use strict'

const S = require('./schema')
const { failure } = require('./contracts')

const MAX_TASKS = 100
const success = ids => ({ ok: true, value: ids })

function evidence(command, context) {
  return { at: context.now, by: command.actor.userId, note: '' }
}

function validateInput(input) {
  if (!S.validate(S.TaskInput, input)) return failure('INVALID_INPUT', '任务字段不完整或格式不正确。')
  if (!input.title.trim()) return failure('INVALID_INPUT', '请填写任务标题。')
  return { ok: true, value: null }
}

function normalize(input) {
  return {
    title: input.title.trim(),
    note: input.note,
    category: input.category,
    assigneeName: input.assigneeName.trim(),
    dueAt: input.dueAt === undefined ? null : input.dueAt,
  }
}

function findTask(state, activityId, taskId) {
  const task = state.tasks.find(t => t.id === taskId)
  if (!task) return failure('NOT_FOUND', '找不到这条任务。')
  if (task.activityId !== activityId) return failure('FORBIDDEN', '任务不属于这场活动。')
  return { ok: true, value: task }
}

function handleTasks(state, command, context) {
  const p = command.payload
  if (['task.create', 'task.update', 'task.status', 'task.remove'].indexOf(p.type) === -1) {
    return failure('INVALID_INPUT', '此任务处理器不支持该操作。')
  }
  const activityId = p.activityId

  if (p.type === 'task.create') {
    const valid = validateInput(p.input)
    if (!valid.ok) return valid
    if (state.tasks.filter(t => t.activityId === activityId).length >= MAX_TASKS) {
      return failure('INVALID_INPUT', '每场活动最多 100 条任务。')
    }
    const task = Object.assign({
      id: context.id('task'), activityId,
      status: 'todo',
      created: evidence(command, context),
      updated: evidence(command, context),
    }, normalize(p.input))
    state.tasks.push(task)
    return success([task.id])
  }

  const found = findTask(state, activityId, p.taskId)
  if (!found.ok) return found
  const task = found.value

  if (p.type === 'task.update') {
    const valid = validateInput(p.input)
    if (!valid.ok) return valid
    Object.assign(task, normalize(p.input), { updated: evidence(command, context) })
    return success([task.id])
  }
  if (p.type === 'task.status') {
    task.status = p.status
    task.updated = evidence(command, context)
    return success([task.id])
  }
  state.tasks = state.tasks.filter(t => t.id !== task.id)
  return success([task.id])
}

module.exports = { handleTasks, MAX_TASKS }
