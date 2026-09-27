import { StateSchema, type State } from '../domain/model';
import type { Command, Context, DispatchResult, Result } from '../domain/contracts';
import { reduceCommand } from '../domain/commands';
import { assertInvariants } from '../domain/invariants';

export const STORAGE_KEY = 'ourtrail.prototype.v1';
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSnapshot(storage: StoragePort): Result<State | null> {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: '无法读取本地记录，请检查浏览器的存储权限。' } };
  }
  if (raw === null) return { ok: true, value: null };
  try {
    const parsed = StateSchema.safeParse(JSON.parse(raw));
    if (parsed.success && assertInvariants(parsed.data).ok) return { ok: true, value: parsed.data };
  } catch {
    return { ok: false, error: { code: 'CORRUPT_SNAPSHOT', message: '本地演示记录无法读取，原始记录未被覆盖。可确认后重置演示。' } };
  }
  return { ok: false, error: { code: 'CORRUPT_SNAPSHOT', message: '本地演示记录不符合当前版本，原始记录未被覆盖。可确认后重置演示。' } };
}

export function createStore(initial: State, storage: StoragePort, context: Context) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispatch(command: Command): DispatchResult {
      const result = reduceCommand(current, command, context);
      if (!result.ok) return result;
      const { state, targetIds, replayed } = result.value;
      if (replayed) return { ok: true, value: { targetIds, replayed } };
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        return { ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: '这次修改没有保存，原安排未改变。请保留输入后重试。' } };
      }
      current = state;
      listeners.forEach(listener => listener());
      return { ok: true, value: { targetIds, replayed } };
    },
  };
}
