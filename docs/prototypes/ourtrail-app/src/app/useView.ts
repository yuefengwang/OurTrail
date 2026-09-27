import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { canonicalPayload, PayloadSchema, type AuthorizedView, type DispatchResult, type DomainError, type Payload, type ReadRequest } from '../domain/contracts';
import { runtime } from './runtime';

export function useRuntimeVersion(): number {
  return useSyncExternalStore(runtime.subscribe, runtime.getVersion, runtime.getVersion);
}
export function useView(request: ReadRequest): AuthorizedView {
  useRuntimeVersion();
  return runtime.read(request);
}

type Attempt = { actor: string | null; canonical: string; payload: Payload; requestId: string; revision: number };
type CommandState = { actor: string | null; busy: boolean; error: DomainError | null; success: string | null };
const idle = (actor: string | null): CommandState => ({ actor, busy: false, error: null, success: null });

/**
 * Only storage/offline failures retain an identical request. A changed payload,
 * actor switch, or explicit run AFTER a displayed conflict creates a new request
 * at the current revision. There is no automatic conflict rebase or retry.
 */
export function useCommand(): {
  run: (payload: Payload) => Promise<DispatchResult>;
  busy: boolean;
  error: DomainError | null;
  success: string | null;
  clearError: () => void;
} {
  useRuntimeVersion();
  const actor = runtime.getActor().userId;
  const [state, setState] = useState<CommandState>(() => idle(actor));
  const retry = useRef<Attempt | null>(null);
  const pending = useRef<Promise<DispatchResult> | null>(null);
  const epoch = useRef(0);
  const currentActor = useRef(actor);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const observeActor = () => {
      const next = runtime.getActor().userId;
      if (next !== currentActor.current) {
        currentActor.current = next; epoch.current += 1;
        retry.current = null; pending.current = null; setState(idle(next));
      }
    };
    observeActor();
    const unsubscribe = runtime.subscribe(observeActor);
    return () => { mounted.current = false; epoch.current += 1; pending.current = null; retry.current = null; unsubscribe(); };
  }, []);

  const run = useCallback((input: Payload): Promise<DispatchResult> => {
    const userId = runtime.getActor().userId;
    if (currentActor.current !== userId) {
      currentActor.current = userId; epoch.current += 1; retry.current = null; pending.current = null;
    }
    if (pending.current) return pending.current;
    const parsed = PayloadSchema.safeParse(input);
    if (!parsed.success) {
      const error: DomainError = { code: 'INVALID_INPUT', message: '操作字段不完整或格式不正确。' };
      retry.current = null; setState({ ...idle(userId), error });
      return Promise.resolve({ ok: false, error });
    }
    const canonical = canonicalPayload(parsed.data);
    let attempt = retry.current;
    if (!attempt || attempt.actor !== userId || attempt.canonical !== canonical) {
      try {
        attempt = { actor: userId, canonical, payload: parsed.data, requestId: globalThis.crypto.randomUUID(), revision: runtime.getRevision() };
      } catch {
        const error: DomainError = { code: 'INVALID_INPUT', message: '当前环境无法生成安全请求号。' };
        setState({ ...idle(userId), error }); return Promise.resolve({ ok: false, error });
      }
    }
    const submitted = attempt;
    const token = epoch.current;
    setState({ ...idle(userId), busy: true });
    const operation = runtime.submitCommand(submitted.payload, submitted.requestId, submitted.revision)
      .catch((): DispatchResult => ({ ok: false, error: { code: 'INVALID_INPUT', message: '操作未完成，请核对当前记录后重试。' } }))
      .then((result) => {
        if (mounted.current && epoch.current === token && runtime.getActor().userId === userId) {
          retry.current = !result.ok && (result.error.code === 'STORAGE_UNAVAILABLE' || result.error.code === 'OFFLINE') ? submitted : null;
          pending.current = null;
          setState({ actor: userId, busy: false, error: result.ok ? null : result.error, success: result.ok ? (result.value.replayed ? '此操作已保存。' : '修改已保存。') : null });
        }
        return result;
      });
    pending.current = operation;
    return operation;
  }, []);
  const clearError = useCallback(() => { setState(previous => ({ ...previous, error: null, success: null })); }, []);
  const visible = state.actor === actor ? state : idle(actor);
  return { run, busy: visible.busy, error: visible.error, success: visible.success, clearError };
}
