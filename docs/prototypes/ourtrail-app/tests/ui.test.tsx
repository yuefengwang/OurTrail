import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityCard } from '../src/components/ActivityCard';
import { AppShell } from '../src/components/AppShell';
import { FormField } from '../src/components/FormField';
import { Icon, TrailMark, type IconName } from '../src/components/Icon';
import { Overlay } from '../src/components/Overlay';
import { PersonRow } from '../src/components/PersonRow';
import { StatusPanel } from '../src/components/StatusPanel';

afterEach(() => vi.restoreAllMocks());

describe('StatusPanel', () => {
  it('announces an unchanged arrangement and offers a working retry', async () => {
    const retry = vi.fn();
    render(<StatusPanel kind="error" title="这次修改没有保存" detail="原安排未改变，你填写的信息仍在。" action={{ label: '重新提交', onClick: retry }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('这次修改没有保存');
    expect(screen.getByRole('alert')).toHaveTextContent('原安排未改变，你填写的信息仍在。');
    await userEvent.setup().click(screen.getByRole('button', { name: '重新提交' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each(['empty', 'loading', 'denied', 'offline'] as const)('%s does not raise an alert', (kind) => {
    render(<StatusPanel kind={kind} title="暂时没有新消息" detail="稍后再来看看。" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('暂时没有新消息')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    if (kind === 'loading') expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('FormField', () => {
  it('associates generated labels, hints and errors with a usable input', async () => {
    render(<FormField label="集合地点" hint="填写大家容易找到的位置" error="请填写集合地点"><input /></FormField>);
    const input = screen.getByLabelText('集合地点');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('填写大家容易找到的位置 请填写集合地点');
    await userEvent.setup().type(input, '地铁站 A 口');
    expect(input).toHaveValue('地铁站 A 口');
  });

  it('preserves an existing description and removes stale error association', () => {
    const { rerender } = render(<><p id="external-hint">仅本次活动可见</p><FormField id="meeting" label="集合点" hint="准确到入口" error="不能为空"><input aria-describedby="external-hint" /></FormField></>);
    expect(screen.getByLabelText('集合点')).toHaveAttribute('id', 'meeting');
    expect(screen.getByLabelText('集合点')).toHaveAccessibleDescription('仅本次活动可见 准确到入口 不能为空');
    rerender(<><p id="external-hint">仅本次活动可见</p><FormField id="meeting" label="集合点" hint="准确到入口"><input aria-describedby="external-hint" /></FormField></>);
    expect(screen.getByLabelText('集合点')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('集合点')).toHaveAccessibleDescription('仅本次活动可见 准确到入口');
    expect(screen.queryByText('不能为空')).not.toBeInTheDocument();
  });

  it('supports select and textarea with distinct generated IDs', () => {
    render(<><FormField label="去程"><select defaultValue="self"><option value="self">自行前往</option></select></FormField><FormField label="备注"><textarea /></FormField></>);
    const select = screen.getByLabelText('去程');
    const textarea = screen.getByLabelText('备注');
    expect(select).toHaveValue('self');
    expect(select.id).not.toBe(textarea.id);
    expect(textarea.tagName).toBe('TEXTAREA');
  });
});

describe('ActivityCard', () => {
  it.each([false, true])('has one named action, including featured=%s', async (featured) => {
    const open = vi.fn();
    render(<ActivityCard title="沿溪走进初夏" date="06.14 周日" meta="轻徒步 · 8 公里" status="报名中" featured={featured} onClick={open}><span>已报名 12 人</span></ActivityCard>);
    const action = screen.getByRole('button', { name: '沿溪走进初夏' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(action).toHaveAccessibleDescription('06.14 周日 轻徒步 · 8 公里 报名中');
    expect(screen.getByText('已报名 12 人')).toBeVisible();
    await userEvent.setup().click(action);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('PersonRow', () => {
  it('keeps identity and a textual status in a list item, with separate actions', async () => {
    const contact = vi.fn();
    render(<ul className="person-list"><PersonRow name="林小满" subtitle="同行人 · 已确认去程" status="待签到" tone="warning"><button onClick={contact}>联系小满</button></PersonRow></ul>);
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('林小满')).toBeVisible();
    expect(within(row).getByText('同行人 · 已确认去程')).toBeVisible();
    expect(within(row).getByText('待签到')).toHaveClass('warning');
    expect(within(row).getByText('林')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.setup().click(within(row).getByRole('button', { name: '联系小满' }));
    expect(contact).toHaveBeenCalledTimes(1);
  });
});

describe('AppShell', () => {
  it('provides a single main landmark and restrained root branding', () => {
    render(<AppShell title="今天想去哪里" root footer={<nav aria-label="主导航">活动</nav>} tools={<button>通知</button>}><p>下一场活动</p></AppShell>);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('下一场活动');
    expect(screen.getByRole('heading', { level: 1, name: '今天想去哪里' })).toBeVisible();
    expect(screen.getByText('演示原型，请勿输入真实个人信息')).toBeVisible();
    expect(screen.getByRole('complementary', { name: '原型说明' })).toHaveTextContent('一次活动，一套协作。');
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeVisible();
  });

  it('connects the detail back button without creating extra landmarks', async () => {
    const back = vi.fn();
    render(<AppShell title="活动详情" onBack={back}><p>集合安排</p></AppShell>);
    await userEvent.setup().click(screen.getByRole('button', { name: '返回' }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: '活动详情' })).toBeVisible();
  });
});

describe('Icon', () => {
  const names: IconName[] = ['activity', 'bell', 'person', 'pin', 'car', 'check', 'route', 'cloud', 'shield', 'search', 'plus', 'back', 'arrow', 'more', 'close', 'copy', 'users', 'clock', 'edit', 'home', 'alert', 'download', 'settings'];
  it.each(names)('%s is a decorative local stroke SVG', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke-width', '1.75');
    expect(svg).toHaveAttribute('width', '22');
    expect(svg?.querySelector('text')).toBeNull();
    expect(svg?.children.length).toBeGreaterThan(0);
  });

  it('has exactly two trail paths in the brand signature', () => {
    const { container } = render(<TrailMark />);
    expect(container.querySelectorAll('svg path')).toHaveLength(2);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Overlay native dialog API (not browser focus-trap verification)', () => {
  const nativeDescriptors = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype);
  afterEach(() => {
    cleanup();
    for (const method of ['showModal', 'close']) {
      const descriptor = nativeDescriptors[method];
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
    }
  });

  function mockNativeDialog() {
    // jsdom has no modal top layer; these doubles only test API coordination.
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
    const close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: showModal },
      close: { configurable: true, value: close },
    });
    return { showModal, close };
  }

  it('opens a titled modal, closes by button, and returns focus to the trigger', async () => {
    const native = mockNativeDialog();
    function Example() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>调整集合点</button><Overlay kind="sheet" open={open} title="集合安排" onClose={() => setOpen(false)}><button>保存安排</button></Overlay></>;
    }
    render(<StrictMode><Example /></StrictMode>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: '调整集合点' });
    await user.click(trigger);
    expect(native.showModal).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '集合安排' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '关闭集合安排' }));
    expect(native.close).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('prevents native cancel and delegates dismissal once', () => {
    mockNativeDialog();
    const onClose = vi.fn();
    render(<Overlay kind="dialog" open title="确认安排" onClose={onClose}><p>请确认去程集合点</p></Overlay>);
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog', { name: '确认安排' }), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
