import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { runtime } from '../src/app/runtime';
import { Notices } from '../src/screens/Notices';
import { Profile } from '../src/screens/Profile';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  runtime.setOffline(false); runtime.setDemoTime('2026-09-24T07:00:00+08:00'); runtime.resetDemo('signup'); runtime.setDemoUser('u-lin');
});

it('修改常用资料保存后可读取且原报名快照不变', async () => {
  render(<MemoryRouter><Profile /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '林溪新资料' } });
  fireEvent.click(screen.getByRole('button', { name: '保存常用资料' }));
  await waitFor(() => expect(runtime.read({ kind: 'profile' })).toMatchObject({ profile: { person: { name: '林溪新资料' } } }));
  expect(runtime.read({ kind: 'activity', activityId: 'a1', perspective: 'participant' })).toMatchObject({ rows: [expect.objectContaining({ name: '林溪' })] });
});

it('通知标记已读只写当前账号，不会广播给其他账号', async () => {
  render(<MemoryRouter initialEntries={['/notices']}><Routes><Route path="/notices" element={<Notices />} /></Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '标记已读' }));
  await waitFor(() => expect(runtime.read({ kind: 'notices' })).toMatchObject({ notices: [expect.objectContaining({ read: true })] }));
});
