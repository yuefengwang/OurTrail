import { expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { reduceCommand } from '../src/domain/commands';
import { selectView, selectExport } from '../src/domain/selectors';
import { NOW, context, makeCommand, must, apply } from './helpers';

it('站内与活动通知共用已读事实，不同账号隔离', () => {
  const state = createFixture('transport', NOW);
  const created = must(reduceCommand(state, makeCommand(state, { type: 'notice.publish', activityId: 'a1', audience: { kind: 'activity' }, content: '请于07:20在犀浦集合。' }), context));
  const noticeId = created.targetIds[0];
  const next = apply(created.state, { type: 'notice.read', activityId: 'a1', noticeId }, 'u-lin');
  for (const request of [{ kind: 'notices' as const }, { kind: 'notices' as const, activityId: 'a1' }]) {
    const view = selectView(next, { userId: 'u-lin' }, request, NOW);
    if (view.kind !== 'notices') throw new Error('Expected notices');
    expect(view.notices.find(n => n.id === noticeId)?.read).toBe(true);
    const other = selectView(next, { userId: 'u-zhou' }, request, NOW);
    if (other.kind !== 'notices') throw new Error('Expected notices');
    expect(other.notices.find(n => n.id === noticeId)?.read).toBe(false);
  }
});

it('外发失败不撤销站内通知，不虚构已复制', () => {
  const state = createFixture('transport', NOW);
  const next = apply(state, { type: 'notice.delivery', activityId: 'a1', noticeId: 'n-meeting', channel: 'subscription_simulation', status: 'failed', detail: '演示渠道失败' });
  expect(next.notices[0].content).toBe(state.notices[0].content);
  expect(next.notices[0].deliveries[0]).toMatchObject({ channel: 'subscription_simulation', status: 'failed', by: 'u-owner' });
  const invalid = reduceCommand(state, makeCommand(state, { type: 'notice.delivery', activityId: 'a1', noticeId: 'n-meeting', channel: 'copy', status: 'simulated_success', detail: '' }), context);
  expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('司机不能导出，敏感导出需要用途与人员，审计不包含医疗明文', () => {
  const state = createFixture('transport', NOW);
  expect(selectExport(state, { userId: 'u-driver' }, 'a1', ['s-lin'], 'sensitive', '核对资料', NOW)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(reduceCommand(state, makeCommand(state, { type: 'export.record', activityId: 'a1', signupIds: [], mode: 'sensitive', purpose: '核实安全' }), context).ok).toBe(false);
  const next = apply(state, { type: 'export.record', activityId: 'a1', signupIds: ['s-lin'], mode: 'sensitive', purpose: '核实安全' });
  expect(next.events.at(-1)).toMatchObject({ kind: 'export.record', subjectIds: ['s-lin'], actorId: 'u-owner' });
  expect(next.events.at(-1)!.summary).toContain('核实安全');
  expect(JSON.stringify(next.events)).not.toContain(state.signups[2].participant.medical);
});

it('归档禁止新通知但仍允许接收人读旧通知', () => {
  const state = createFixture('archived', NOW);
  expect(reduceCommand(state, makeCommand(state, { type: 'notice.publish', activityId: 'a1', audience: { kind: 'activity' }, content: '新内容' }), context)).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
  expect(apply(state, { type: 'notice.read', activityId: 'a1', noticeId: 'n-meeting' }, 'u-lin').notices[0].readBy['u-lin']).toBe(NOW);
});
