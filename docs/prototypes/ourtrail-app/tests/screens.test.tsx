import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { selectView } from '../src/domain/selectors';
import type { ReadRequest } from '../src/domain/contracts';
import { Signup } from '../src/screens/Signup';
import { ActivityDetail } from '../src/screens/ActivityDetail';
import { ActivityEditor } from '../src/screens/ActivityEditor';

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn(), draft: vi.fn(), go: vi.fn(), actorId: 'u-new', remember: vi.fn() }));
vi.mock('../src/app/navigation', () => ({ useAppNavigation: () => ({ go: mocks.go, back: vi.fn() }), useOverlayHistory: () => {} }));
vi.mock('../src/app/runtime', () => ({ runtime: {
  getActor: () => ({ userId: mocks.actorId }), getPerspective: () => 'participant',
  rememberActivity: mocks.remember,
  getNow: () => '2026-09-24T09:00:00+08:00', getRevision: () => 0,
  getDraft: () => undefined, setDraft: mocks.draft, clearDraft: vi.fn(),
  read: mocks.read, readSignupForm: vi.fn(), can: () => ({ ok: true, value: null }),
} }));
vi.mock('../src/app/useView', () => ({
  useView: (request: ReadRequest) => mocks.read(request), useRuntimeVersion: () => 0,
  useCommand: () => ({ run: mocks.run, busy: false, error: null, success: null, clearError: vi.fn() }),
}));

function mount(path = '/activities/a1/signup') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/activities/:activityId/signup" element={<Signup />} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actorId = 'u-new';
  const state = createFixture('signup', '2026-09-24T09:00:00+08:00');
  mocks.read.mockImplementation((request: ReadRequest) => selectView(state, { userId: mocks.actorId }, request, state.savedAt));
  mocks.run.mockResolvedValue({ ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: '本次保存失败，输入仍保留。' } });
});

describe('Signup boundary and form safety', () => {
  it('validates required fields before dispatch and focuses the first missing field', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '提交报名' }));
    expect(mocks.run).not.toHaveBeenCalled();
    expect(await screen.findByText('请填写姓名')).toBeVisible();
    expect(screen.getByLabelText('姓名')).toHaveFocus();
  });

  it('retains edited values and unchecked permissions after a storage failure', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '顾言（演示）' } });
    fireEvent.click(screen.getByLabelText(/同意本次活动使用/));
    fireEvent.click(screen.getByRole('button', { name: '提交报名' }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('本次保存失败，输入仍保留。')).toBeVisible();
    expect(screen.getByLabelText('姓名')).toHaveValue('顾言（演示）');
    expect(screen.getByLabelText(/授权代为确认安全到家/)).not.toBeChecked();
    expect(mocks.go).not.toHaveBeenCalled();
  });

  it('renders permission denial without exposing or submitting a form', () => {
    mocks.read.mockReturnValue({ kind: 'denied', code: 'FORBIDDEN', message: '未发布活动仅所有者可见。' });
    mount('/activities/private/signup');
    expect(screen.getByText('未发布活动仅所有者可见。')).toBeVisible();
    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交报名' })).not.toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('never silently retries capacity errors as a waitlist submission', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: { code: 'CAPACITY', message: '整组名额不足。' } });
    mount();
    fireEvent.click(screen.getByLabelText(/同意本次活动使用/));
    fireEvent.click(screen.getByRole('button', { name: '提交报名' }));
    await screen.findByRole('button', { name: '明确同意整组候补' });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0][0].mode).toBe('apply');
    fireEvent.click(screen.getByRole('button', { name: '明确同意整组候补' }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
    expect(mocks.run.mock.calls[1][0]).toMatchObject({ type: 'signup.submit', mode: 'waitlist', keepTogether: true });
  });

  it('keeps proxy authority and proxy home independent for a companion', async () => {
    mocks.actorId = 'u-zhou';
    mount();
    fireEvent.click(screen.getByLabelText(/苏晴.*同行人/));
    const consents = screen.getAllByLabelText(/同意本次活动使用/);
    consents.forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(screen.getByRole('button', { name: '提交报名' }));
    expect(mocks.run).not.toHaveBeenCalled();
    expect(screen.getByText('代报名需要同行人明确授权')).toBeVisible();
    fireEvent.click(screen.getAllByLabelText(/已获同行人授权/)[1]);
    fireEvent.click(screen.getByRole('button', { name: '提交报名' }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect(mocks.run.mock.calls[0][0].participants[1].consent).toEqual({ dataUse: true, proxyAuthority: true, proxyHome: false });
  });
});

describe('Activity screen safeguards', () => {
  it('does not offer attendance actions to a nonjoined visitor in the active phase', () => {
    const state = createFixture('active', '2026-09-26T10:00:00+08:00');
    mocks.read.mockImplementation((request: ReadRequest) => selectView(state, { userId: mocks.actorId }, request, state.savedAt));
    render(<MemoryRouter initialEntries={['/activities/a1']}><Routes><Route path="/activities/:activityId" element={<ActivityDetail />} /></Routes></MemoryRouter>);
    expect(screen.getByText('本次报名已关闭')).toBeVisible();
    expect(screen.queryByRole('button', { name: /签到|更新我的同行状态|确认返程与到家/ })).not.toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('does not fall back to a seeded activity for an invalid detail ID', () => {
    render(<MemoryRouter initialEntries={['/activities/missing']}><Routes><Route path="/activities/:activityId" element={<ActivityDetail />} /></Routes></MemoryRouter>);
    expect(screen.getByText('找不到此活动。')).toBeVisible();
    expect(screen.queryByText('青城后山')).not.toBeInTheDocument();
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it('saves empty dates as null and previews the returned activity without publishing', async () => {
    mocks.run.mockResolvedValue({ ok: true, value: { targetIds: ['created-activity'], replayed: false } });
    render(<MemoryRouter initialEntries={['/activities/new']}><Routes><Route path="/activities/new" element={<ActivityEditor />} /></Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('活动名称'), { target: { value: '待完善的演示同行' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并预览' }));
    await waitFor(() => expect(mocks.go).toHaveBeenCalledWith('/activities/created-activity?preview=1'));
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0][0]).toMatchObject({ type: 'activity.create', input: { startAt: null, endAt: null, deadlineAt: null, title: '待完善的演示同行' } });
    expect(mocks.run.mock.calls[0][0]).not.toHaveProperty('participation');
  });
});
