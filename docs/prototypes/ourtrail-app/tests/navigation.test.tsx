import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HashRouter, MemoryRouter, useLocation, useNavigate } from 'react-router';
import { useAppNavigation, useOverlayHistory } from '../src/app/navigation';

beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(async () => { cleanup(); await act(async () => { await Promise.resolve(); }); vi.restoreAllMocks(); });
function NavHost() {
  const nav = useAppNavigation(); const location = useLocation(); const navigate = useNavigate();
  return <><output data-testid="path">{location.pathname}{location.search}</output>
    <div className="app-main" data-testid="scroller" />
    <button onClick={() => nav.go('/activities/a1?tab=roster')}>Detail</button>
    <button onClick={() => nav.go('/notices')}>Notices</button>
    <button onClick={() => nav.go('/me', true)}>Replace</button>
    <button onClick={nav.back}>Back</button>
    <button onClick={() => navigate(-1)}>Browser back</button>
    {['https://evil.test', '//evil.test', '/unknown', '/activities/a1/unknown', '/\\evil.test', '/activities/%2F%2Fevil'].map(path => <button key={path} onClick={() => nav.go(path)}>{path}</button>)}
  </>;
}
it.each(['https://evil.test', '//evil.test', '/unknown', '/activities/a1/unknown', '/\\evil.test', '/activities/%2F%2Fevil'])('rejects non-app navigation %s', path => {
  render(<MemoryRouter initialEntries={['/me']}><NavHost /></MemoryRouter>);
  fireEvent.click(screen.getByText(path)); expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/);
});
it('direct detail back replaces home, never an unknown external predecessor', () => {
  render(<MemoryRouter initialEntries={['/notices', '/activities/a1']} initialIndex={1}><NavHost /></MemoryRouter>);
  fireEvent.click(screen.getByText('Back')); expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/);
});
it('restores actual in-app query and scroll through push, pop and replace', () => {
  render(<MemoryRouter initialEntries={['/?filter=mine&search=山']}><NavHost /></MemoryRouter>);
  const scroller = screen.getByTestId('scroller');
  scroller.scrollTop = 321;
  fireEvent.scroll(scroller); fireEvent.click(screen.getByText('Detail'));
  scroller.scrollTop = 0;
  fireEvent.click(screen.getByText('Replace')); expect(screen.getByTestId('path')).toHaveTextContent('/me');
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByTestId('path')).toHaveTextContent('/?filter=mine&search=山');
  expect(scroller.scrollTop).toBe(321);
});
it('tracks browser POP rather than using history.length', () => {
  render(<StrictMode><MemoryRouter><NavHost /></MemoryRouter></StrictMode>);
  fireEvent.click(screen.getByText('Detail')); fireEvent.click(screen.getByText('Notices'));
  fireEvent.click(screen.getByText('Browser back')); expect(screen.getByTestId('path')).toHaveTextContent('/activities/a1?tab=roster');
  fireEvent.click(screen.getByText('Back')); expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/);
});

function ModalHost({ initial = false, closed = () => {} }: { initial?: boolean; closed?: () => void }) {
  const [open, setOpen] = useState(initial);
  useOverlayHistory(open, () => { closed(); setOpen(false); });
  return <><button onClick={() => setOpen(true)}>Open</button>{open && <div role="dialog" onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}><button onClick={() => setOpen(false)}>Close</button></div>}</>;
}
async function browserBack() {
  await act(async () => { await new Promise<void>(resolve => { window.addEventListener('popstate', () => resolve(), { once: true }); window.history.back(); }); });
}
it('browser Back closes standalone overlay and preserves router history state and URL', async () => {
  window.history.replaceState({ idx: 7, key: 'route-key', usr: { selected: 's-lin' } }, '', '/#/activities/a1?tab=roster');
  const original = window.history.state; const closed = vi.fn();
  render(<ModalHost closed={closed} />); fireEvent.click(screen.getByText('Open'));
  expect(window.history.state).toMatchObject(original);
  expect(window.location.hash).toBe('#/activities/a1?tab=roster');
  await browserBack();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(closed).toHaveBeenCalledOnce();
  expect(window.history.state).toEqual(original);
});
it('StrictMode only pushes once and button dismissal consumes just its entry', async () => {
  window.history.replaceState({ idx: 1, key: 'strict' }, '', '/#/me');
  const push = vi.spyOn(window.history, 'pushState'); const back = vi.spyOn(window.history, 'back');
  render(<StrictMode><ModalHost initial /></StrictMode>);
  await act(async () => { await Promise.resolve(); });
  expect(push).toHaveBeenCalledOnce(); expect(back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Close'));
  await waitFor(() => expect(window.history.state).toEqual({ idx: 1, key: 'strict' }));
  expect(back).toHaveBeenCalledOnce(); expect(window.location.hash).toBe('#/me');
});
it('Escape consumes the modal entry, and a quick reopen waits for pending pop', async () => {
  window.history.replaceState({ idx: 2, key: 'esc' }, '', '/#/activities/a1');
  render(<ModalHost initial />);
  const oldToken = window.history.state.__ourtrailOverlay;
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByText('Open'));
  await waitFor(() => {
    expect(window.history.state.__ourtrailOverlay).toBeTruthy();
    expect(window.history.state.__ourtrailOverlay).not.toBe(oldToken);
  });
  await browserBack();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(window.location.hash).toBe('#/activities/a1');
});
it('HashRouter remains on the page on modal Back, then follows actual app Back', async () => {
  window.history.replaceState(null, '', '/#/');
  render(<HashRouter><NavHost /><ModalHost /></HashRouter>);
  fireEvent.click(screen.getByText('Detail')); fireEvent.click(screen.getByText('Open'));
  await browserBack(); expect(screen.getByTestId('path')).toHaveTextContent('/activities/a1?tab=roster');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Back'));
  await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/));
});
it('multiple StrictMode overlays do not start cleanup traversal during re-setup', async () => {
  window.history.replaceState({ idx: 4, key: 'nested' }, '', '/#/me');
  const back = vi.spyOn(window.history, 'back');
  render(<StrictMode><ModalHost initial /><ModalHost initial /></StrictMode>);
  await act(async () => { await Promise.resolve(); });
  expect(back).not.toHaveBeenCalled(); expect(screen.getAllByRole('dialog')).toHaveLength(2);
  await browserBack(); expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await browserBack(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(window.history.state).toEqual({ idx: 4, key: 'nested' });
});
it('navigation waits for modal cleanup rather than backing over the new route', async () => {
  window.history.replaceState(null, '', '/#/');
  render(<HashRouter><NavHost /><ModalHost /></HashRouter>);
  fireEvent.click(screen.getByText('Detail')); fireEvent.click(screen.getByText('Open'));
  fireEvent.click(screen.getByText('Notices'));
  await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/notices'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await browserBack(); expect(screen.getByTestId('path')).toHaveTextContent('/activities/a1?tab=roster');
  await browserBack(); expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/);
});
