import { describe, expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import type { State, SignupRecord } from '../src/domain/model';
import { AuthorizedViewSchema, type ActivityView, type Actor, type Payload, type Result } from '../src/domain/contracts';
import { canExecute, canReadNotice, isOwnSignup, isOwner, staffCan, vehicleCan } from '../src/domain/permissions';
import { getDetailState, selectAccess, selectContact, selectExport, selectNoticeManagement, selectSensitive, selectSignupForm, selectTransport, selectView } from '../src/domain/selectors';

const NOW = '2026-09-24T07:00:00+08:00';
const actor = (userId: string | null): Actor => ({ userId });
const owner = actor('u-owner');
const staff = actor('u-staff');
const driver = actor('u-driver');
const lin = actor('u-lin');
const zhou = actor('u-zhou');
const other = actor('u-other');
const guest = actor(null);
function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
function denied(result: Result<unknown>, code = 'FORBIDDEN') {
  expect(result).toMatchObject({ ok: false, error: { code, message: expect.any(String) } });
  if (!result.ok) expect(result.error.message.length).toBeGreaterThan(0);
}
function activity(state: State, who: Actor, perspective: ActivityView['perspective'] = 'participant', extra = {}): ActivityView {
  const view = selectView(state, who, { kind: 'activity', activityId: 'a1', perspective, ...extra }, NOW);
  expect(AuthorizedViewSchema.safeParse(view).success).toBe(true);
  if (view.kind !== 'activity') throw new Error(JSON.stringify(view));
  return view;
}
function signup(state: State, id: string): SignupRecord { return state.signups.find((s) => s.id === id)!; }
function auth(state: State, who: Actor, payload: Payload) { return canExecute(state, who, payload, NOW); }
function foreign(state: State) {
  state.activities.push({ ...structuredClone(state.activities[0]), id: 'a2', ownerId: 'u-other' });
  state.signups.push({ ...structuredClone(signup(state, 's-lin')), id: 'foreign', activityId: 'a2' });
  state.vehicles.push({ ...structuredClone(state.vehicles[0]), id: 'foreign-car', activityId: 'a2' });
}

describe('resource authorization', () => {
  it('requires an actor even for signup and does not trust requested perspective', () => {
    const state = createFixture('transport', NOW);
    denied(auth(state, guest, { type: 'signup.submit', activityId: 'a1', participants: [], keepTogether: false, mode: 'apply' }), 'AUTH_REQUIRED');
    expect(selectView(state, other, { kind: 'activity', activityId: 'a1', perspective: 'organizer' }, NOW)).toMatchObject({ kind: 'denied', code: 'FORBIDDEN' });
    expect(isOwner(state, other, 'a1')).toBe(false);
    expect(isOwnSignup(signup(state, 's-su'), zhou)).toBe(true);
    expect(isOwnSignup(signup(state, 's-lin'), owner)).toBe(false);
  });

  it('validates signup submit sources against the current account and companion library', () => {
    const state = createFixture('transport', NOW);
    const input = must(selectSignupForm(state, zhou, 'a1', 's-su', '', NOW)).input;
    const payload: Payload = { type: 'signup.submit', activityId: 'a1', participants: [input], mode: 'apply', keepTogether: true };
    expect(auth(state, zhou, payload).ok).toBe(true);
    denied(auth(state, other, payload));
    state.profiles.find((p) => p.id === 'u-zhou')!.companions = [];
    denied(auth(state, zhou, payload));
    input.personRef = { kind: 'user', userId: 'u-lin' };
    denied(auth(state, zhou, payload));
  });

  it('separates resource permission from phase so replay authorization survives phase changes', () => {
    const state = createFixture('archived', NOW);
    expect(auth(state, lin, { type: 'signup.cancel', activityId: 'a1', signupIds: ['s-lin'], reason: '' }).ok).toBe(true);
    expect(auth(state, owner, { type: 'activity.publish', activityId: 'a1', participation: null }).ok).toBe(true);
    expect(auth(state, driver, { type: 'vehicle.depart', activityId: 'a1', vehicleId: 'v1', leg: 'outbound', note: '' }).ok).toBe(true);
  });

  it('uses every target and activity-local capability scope, including exact expiry', () => {
    const state = createFixture('transport', NOW);
    expect(staffCan(state, staff, 'a1', 'checkin', ['s-lin'], NOW)).toBe(true);
    expect(staffCan(state, staff, 'a1', 'checkin', ['s-lin', 's-walker-16'], NOW)).toBe(false);
    denied(auth(state, staff, { type: 'incident.report', activityId: 'a1', signupIds: ['s-lin', 's-walker-16'], kind: 'other', description: '' }));
    state.memberships[0].expiresAt = NOW;
    expect(staffCan(state, staff, 'a1', 'checkin', ['s-lin'], NOW)).toBe(false);
    expect(selectView(state, staff, { kind: 'activity', activityId: 'a1', perspective: 'staff' }, NOW)).toMatchObject({ kind: 'denied', code: 'FORBIDDEN' });
  });

  it('locates all referenced resources and rejects cross-activity injections even for the owner', () => {
    const state = createFixture('transport', NOW);
    foreign(state);
    const payloads: Payload[] = [
      { type: 'signup.review', activityId: 'a1', signupIds: ['s-lin', 'foreign'], decision: 'confirm' },
      { type: 'assignment.set', activityId: 'a1', target: { signupId: 's-lin', vehicleId: 'foreign-car', seatLabel: null } },
      { type: 'vehicle.save', activityId: 'a1', vehicleId: 'v1', input: { label: '', plate: '', legalCapacity: 4, blockedSeats: 0, drivers: [{ kind: 'participant', signupId: 'foreign' }], seatLabels: null, pickupPointIds: [] } },
      { type: 'notice.publish', activityId: 'a1', audience: { kind: 'signups', signupIds: ['foreign'] }, content: '' },
      { type: 'membership.save', activityId: 'a1', membership: { ...state.memberships[0], activityId: 'a2' } },
      { type: 'membership.save', activityId: 'a1', membership: { role: 'staff', id: 'new', userId: 'u-other', activityId: 'a1', expiresAt: NOW, scope: { kind: 'selected', signupIds: ['foreign'] }, capabilities: ['roster'] } },
      { type: 'assignment.commit', activityId: 'a1', preview: { activityId: 'a2', baseRevision: 0, assignments: [], unassigned: [] } },
    ];
    for (const payload of payloads) denied(auth(state, owner, payload));
    denied(auth(state, owner, { type: 'signup.cancel', activityId: 'a1', signupIds: ['missing'], reason: '' }), 'NOT_FOUND');
    denied(selectContact(state, owner, 'a1', 'foreign', NOW));
    denied(auth(state, staff, { type: 'membership.revoke', activityId: 'a1', membershipId: 'm-driver' }));
  });

  it('keeps vehicle contact authority on its vehicle and excludes unrelated staff boarding', () => {
    const state = createFixture('transport', NOW);
    expect(vehicleCan(state, driver, 'a1', 'v1', NOW)).toBe(true);
    expect(vehicleCan(state, driver, 'a1', 'v2', NOW)).toBe(false);
    const board: Payload = { type: 'attendance.board', activityId: 'a1', signupId: 's-lin', leg: 'outbound', boarded: true, note: '' };
    expect(auth(state, driver, board).ok).toBe(true);
    denied(auth(state, staff, board));
    denied(auth(state, lin, board));
    denied(auth(state, driver, { ...board, signupId: state.assignments.find((a) => a.vehicleId === 'v2')!.signupId }));
    denied(auth(state, driver, { type: 'attendance.node', activityId: 'a1', signupId: 's-lin', pointId: 'pt-taian', note: '' }));
    denied(auth(state, driver, { type: 'vehicle.complete', activityId: 'a1', vehicleId: 'v2', leg: 'return', note: '' }));
  });

  it('requires proxyHome consent and actual-self position reports', () => {
    const state = createFixture('active', NOW);
    const home: Payload = { type: 'attendance.home', activityId: 'a1', signupId: 's-su', note: '' };
    denied(auth(state, zhou, home), 'CONSENT_REQUIRED');
    signup(state, 's-su').consent.proxyHome = true;
    expect(auth(state, zhou, home).ok).toBe(true);
    expect(auth(state, owner, home).ok).toBe(true);
    const report: Payload = { type: 'position.report', activityId: 'a1', signupId: 's-su', coordinates: { lat: 30, lng: 103 }, consent: true };
    denied(auth(state, zhou, report));
    denied(auth(state, owner, report));
    expect(auth(state, lin, { ...report, signupId: 's-lin' }).ok).toBe(true);
    expect(auth(state, zhou, { type: 'position.revoke', activityId: 'a1', signupId: 's-su' }).ok).toBe(true);
    signup(state, 's-su').consent.proxyAuthority = false;
    denied(auth(state, zhou, { type: 'position.revoke', activityId: 'a1', signupId: 's-su' }), 'CONSENT_REQUIRED');
  });

  it('resolves incidents only over all current subjects', () => {
    const state = createFixture('active', NOW);
    state.incidents[0].subjectIds.push('s-walker-16');
    denied(auth(state, staff, { type: 'incident.resolve', activityId: 'a1', incidentId: 'i-su', note: '' }));
    expect(auth(state, owner, { type: 'incident.resolve', activityId: 'a1', incidentId: 'i-su', note: '' }).ok).toBe(true);
    foreign(state);
    state.incidents[0].subjectIds.push('foreign');
    denied(auth(state, owner, { type: 'incident.resolve', activityId: 'a1', incidentId: 'i-su', note: '' }));
  });
});

describe('whitelisted projections', () => {
  it('does not give a submitter contact data after proxy authorization is absent', () => {
    const state = createFixture('transport', NOW);
    signup(state, 's-su').consent.proxyAuthority = false;
    denied(selectContact(state, zhou, 'a1', 's-su', NOW));
  });

  it('prefers the current reapplication to a cancelled historical signup', () => {
    const state = createFixture('signup', NOW);
    const previous = signup(state, 's-lin');
    previous.status = 'cancelled';
    state.signups.push({ ...structuredClone(previous), id: 's-lin-new', status: 'pending' });
    expect(activity(state, lin).primarySignupId).toBe('s-lin-new');
    expect(getDetailState(activity(state, lin), NOW)).toBe('pending');
  });

  it('does not conceal an inconsistent capacity through clamping', () => {
    const state = createFixture('signup', NOW);
    state.activities[0].capacity = 20;
    expect(activity(state, owner, 'organizer').counters.remaining).toBe(-1);
  });

  it('offers location only while active and home only during closing', () => {
    const gathering = createFixture('gathering', NOW);
    expect(activity(gathering, lin).permittedActions).not.toContain('position.report');
    const active = createFixture('active', NOW);
    expect(activity(active, lin).permittedActions).not.toContain('attendance.home');
    active.activities[0].phase = 'gathering';
    expect(activity(active, owner, 'organizer').positions).toEqual([]);
    expect(activity(createFixture('closing', NOW), lin).permittedActions).toContain('attendance.home');
  });

  it('offers authorized late-arrival reconciliation and active return boarding', () => {
    const state = createFixture('active', NOW);
    const record = state.attendance.find(a => a.signupId === 's-lin')!;
    record.checkIn = null;
    record.boardingByLeg.outbound = null;
    record.departure = { kind: 'coordinating', evidence: { at: NOW, by: 'u-owner', note: '迟到协调' } };
    const actions = activity(state, owner, 'organizer').permittedActions;
    for (const type of ['attendance.checkin', 'attendance.departure', 'attendance.board']) expect(actions).toContain(type);
    expect(activity(state, driver, 'vehicle').permittedActions).toContain('attendance.board');
  });

  it('projects the separate return plan needed for vehicle headcounts without personal notes', () => {
    const state = createFixture('closing', NOW);
    const view = activity(state, driver, 'vehicle');
    const su = view.vehicleTask!.passengers.find(p => p.signupId === 's-su')!;
    expect(su).toMatchObject({ returnPlan: 'independent' });
    expect(JSON.stringify(su)).not.toContain('evidence');
  });

  it('allows public descriptions without discovery or draft leaks', () => {
    const state = createFixture('transport', NOW);
    expect(activity(state, guest).rows).toEqual([]);
    expect(selectView(state, guest, { kind: 'home', perspective: 'participant', openedActivityIds: [] }, NOW)).toEqual({ kind: 'home', activities: [] });
    expect(selectView(state, guest, { kind: 'home', perspective: 'participant', openedActivityIds: ['a1'] }, NOW)).toMatchObject({ kind: 'home', activities: [{ id: 'a1' }] });
    state.activities[0].phase = 'draft';
    expect(selectView(state, guest, { kind: 'activity', activityId: 'a1', perspective: 'participant' }, NOW)).toMatchObject({ kind: 'denied', code: 'FORBIDDEN' });
    expect(activity(state, owner, 'organizer').activity.phase).toBe('draft');
    expect(selectView(state, owner, { kind: 'activity', activityId: 'missing', perspective: 'organizer' }, NOW)).toMatchObject({ kind: 'denied', code: 'NOT_FOUND' });
  });

  it('keeps participant rows and safety counts personal, with no arbitrary primary signup', () => {
    const state = createFixture('closing', NOW);
    const view = activity(state, zhou);
    expect(view.rows.map((r) => r.signupId)).toEqual(['s-zhou', 's-su']);
    expect(view.primarySignupId).toBe('s-zhou');
    expect(view.counters.pendingHome).toBe(1);
    expect(view.counters.openIncidents).toBe(1);
    expect(activity(state, lin).incidents).toEqual([]);
    expect(activity(state, other).primarySignupId).toBeNull();
    expect(activity(state, other).counters.pendingHome).toBe(0);
    expect(activity(state, other, 'participant', { selectedSignupId: 's-lin' }).primarySignupId).toBeNull();
    expect(activity(state, zhou, 'participant', { selectedSignupId: 's-su' }).primarySignupId).toBe('s-su');
    state.signups = state.signups.filter((s) => s.id !== 's-zhou');
    expect(activity(state, zhou).primarySignupId).toBeNull();
    expect(activity(state, zhou, 'participant', { selectedSignupId: 's-su' }).primarySignupId).toBe('s-su');
    for (const row of view.rows) expect(Object.keys(row).sort()).toEqual(['signupId', 'groupId', 'name', 'status', 'pickup', 'vehicle', 'seat', 'checkedIn', 'outboundBoarded', 'returnBoarded', 'returnPlan', 'departure', 'home'].sort());
  });

  it('limits staff roster and incidents to capabilities and all scoped subjects', () => {
    const state = createFixture('active', NOW);
    const view = activity(state, staff, 'staff');
    expect(view.rows).toHaveLength(6);
    expect(view.positions).toHaveLength(6);
    expect(view.counters.unchecked).toBe(0);
    state.incidents[0].subjectIds.push('s-walker-16');
    expect(activity(state, staff, 'staff').incidents).toEqual([]);
    const membership = state.memberships[0];
    if (membership.role !== 'staff') throw new Error('fixture');
    membership.capabilities = ['checkin'];
    expect(activity(state, staff, 'staff').rows).toEqual([]);
    expect(activity(state, staff, 'staff').positions).toEqual([]);
    expect(activity(state, staff, 'staff').counters.pendingHome).toBe(0);
  });

  it('serializes vehicle views with only this vehicle passengers and necessary contact', () => {
    const state = createFixture('active', NOW);
    const view = activity(state, driver, 'vehicle', { vehicleId: 'v1' });
    expect(view.positions).toEqual([]);
    expect(view.incidents).toEqual([]);
    expect(view.vehicleTask!.passengers.map((p) => p.signupId).sort()).toEqual(state.assignments.filter((a) => a.vehicleId === 'v1').map((a) => a.signupId).sort());
    const json = JSON.stringify(view);
    expect(json).not.toContain('medical');
    expect(json).not.toContain('emergency');
    expect(json).not.toContain('consentExpiresAt');
    expect(json).not.toContain('v2');
    expect(json).not.toContain('00000000090');
    expect(view.vehicleTask!.passengers.every((p) => p.phone === signup(state, p.signupId).participant.phone)).toBe(true);
    expect(selectView(state, driver, { kind: 'activity', activityId: 'a1', perspective: 'vehicle', vehicleId: 'v2' }, NOW)).toMatchObject({ kind: 'denied', code: 'FORBIDDEN' });
    denied(selectSensitive(state, driver, 'a1', 's-lin', 'work', NOW));
    denied(selectExport(state, driver, 'a1', ['s-lin'], 'ordinary', '', NOW));
  });

  it('does not inherit hidden fields or expose shared mutable state', () => {
    const state = createFixture('transport', NOW);
    Object.assign(state.activities[0], { secret: 'hidden' });
    Object.assign(signup(state, 's-lin'), { secret: 'hidden' });
    const before = JSON.stringify(state);
    const view = activity(state, lin);
    expect(JSON.stringify(view)).not.toContain('hidden');
    view.activity.routeSnapshot.points[0].name = 'changed';
    view.rows[0].name = 'changed';
    expect(JSON.stringify(state)).toBe(before);
    const form = must(selectSignupForm(state, lin, 'a1', 's-lin', '', NOW));
    form.input.participant.emergency.phone = 'changed';
    expect(JSON.stringify(state)).toBe(before);
  });

  it('home uses own historical signups, activity ownership, perspective membership and explicit opened IDs only', () => {
    const state = createFixture('archived', NOW);
    foreign(state);
    expect(selectView(state, lin, { kind: 'home', perspective: 'participant', openedActivityIds: [] }, NOW)).toMatchObject({ activities: [{ id: 'a1' }, { id: 'a2' }] });
    expect(selectView(state, owner, { kind: 'home', perspective: 'organizer', openedActivityIds: [] }, NOW)).toMatchObject({ activities: [{ id: 'a1' }] });
    expect(selectView(state, driver, { kind: 'home', perspective: 'participant', openedActivityIds: [] }, NOW)).toEqual({ kind: 'home', activities: [] });
    expect(selectView(state, driver, { kind: 'home', perspective: 'vehicle', openedActivityIds: [] }, NOW)).toMatchObject({ activities: [{ id: 'a1' }] });
  });
});

describe('personal and sensitive data', () => {
  it('requires self, consenting proxy, or scoped current work with a purpose', () => {
    const state = createFixture('active', NOW);
    expect(selectSensitive(state, lin, 'a1', 's-lin', '', NOW).ok).toBe(true);
    expect(selectSensitive(state, zhou, 'a1', 's-su', '', NOW).ok).toBe(true);
    denied(selectSensitive(state, owner, 'a1', 's-lin', ' ', NOW));
    expect(selectSensitive(state, owner, 'a1', 's-lin', '安全联络', NOW).ok).toBe(true);
    denied(selectSensitive(state, staff, 'a1', 's-lin', '安全联络', NOW));
    const membership = state.memberships[0];
    if (membership.role !== 'staff') throw new Error('fixture');
    membership.capabilities.push('sensitive');
    expect(selectSensitive(state, staff, 'a1', 's-lin', '安全联络', NOW).ok).toBe(true);
    denied(selectSensitive(state, staff, 'a1', 's-walker-16', '安全联络', NOW));
    membership.expiresAt = NOW;
    denied(selectSensitive(state, staff, 'a1', 's-lin', '安全联络', NOW));
    signup(state, 's-su').consent.proxyAuthority = false;
    denied(selectSensitive(state, zhou, 'a1', 's-su', '', NOW), 'CONSENT_REQUIRED');
  });

  it('enforces sensitive restrictions on ordinary edits and form loading', () => {
    const state = createFixture('transport', NOW);
    const payload: Payload = { type: 'signup.edit', activityId: 'a1', signupId: 's-lin', participant: signup(state, 's-lin').participant, trip: signup(state, 's-lin').trip, purpose: '' };
    denied(auth(state, owner, payload));
    expect(auth(state, owner, { ...payload, purpose: '更正联系方式' }).ok).toBe(true);
    denied(selectSignupForm(state, owner, 'a1', 's-lin', '', NOW));
    expect(selectSignupForm(state, owner, 'a1', 's-lin', '更正', NOW).ok).toBe(true);
    state.activities[0].phase = 'archived';
    denied(auth(state, owner, { ...payload, purpose: '更正' }));
    denied(selectSensitive(state, owner, 'a1', 's-lin', '更正', NOW));
    expect(selectSignupForm(state, lin, 'a1', 's-lin', '', NOW).ok).toBe(true);
    denied(selectContact(state, owner, 'a1', 's-lin', NOW));
    expect(selectContact(state, lin, 'a1', 's-lin', NOW).ok).toBe(true);
  });

  it('contacts are explicit minimal records and work scope remains local', () => {
    const state = createFixture('transport', NOW);
    expect(must(selectContact(state, staff, 'a1', 's-lin', NOW))).toEqual({ name: signup(state, 's-lin').participant.name, phone: signup(state, 's-lin').participant.phone });
    denied(selectContact(state, staff, 'a1', 's-walker-16', NOW));
    expect(selectContact(state, driver, 'a1', 's-lin', NOW).ok).toBe(true);
    denied(selectContact(state, driver, 'a1', state.assignments.find((a) => a.vehicleId === 'v2')!.signupId, NOW));
    for (const selector of [selectTransport, selectAccess, selectNoticeManagement]) {
      expect(selector(state, owner, 'a1', NOW).ok).toBe(true);
      denied(selector(state, staff, 'a1', NOW));
      denied(selector(state, driver, 'a1', NOW));
      denied(selector(state, owner, 'missing', NOW), 'NOT_FOUND');
    }
  });

  it('hides invalid, expired, revoked and post-active positions; stale means strictly over 30 minutes', () => {
    const state = createFixture('active', NOW);
    state.positions.find((p) => p.signupId === 's-lin')!.reportedAt = new Date(Date.parse(NOW) - 30 * 60_000).toISOString();
    expect(activity(state, lin).positions).toHaveLength(1);
    expect(activity(state, lin).positions[0].stale).toBe(false);
    state.positions.find((p) => p.signupId === 's-lin')!.reportedAt = new Date(Date.parse(NOW) - 30 * 60_000 - 1).toISOString();
    expect(activity(state, lin).positions[0].stale).toBe(true);
    expect(activity(state, zhou).positions.map((p) => p.signupId)).toEqual(['s-zhou', 's-su']);
    signup(state, 's-su').consent.proxyAuthority = false;
    expect(activity(state, zhou).positions.map((p) => p.signupId)).toEqual(['s-zhou']);
    const p = state.positions.find((item) => item.signupId === 's-lin')!;
    p.consentExpiresAt = NOW;
    expect(activity(state, lin).positions).toEqual([]);
    p.consentExpiresAt = state.activities[0].endAt!;
    p.revokedAt = NOW;
    expect(activity(state, lin).positions).toEqual([]);
    p.revokedAt = null;
    p.coordinates.lat = 91;
    expect(activity(state, lin).positions).toEqual([]);
    for (const phase of ['closing', 'archived', 'cancelled'] as const) {
      state.activities[0].phase = phase;
      expect(activity(state, owner, 'organizer').positions).toEqual([]);
    }
  });

  it('exports exactly nine ordinary columns, only selected sensitive people, and neutralizes formulas', () => {
    const state = createFixture('transport', NOW);
    signup(state, 's-lin').participant.name = '  =HYPERLINK("x")';
    const csv = must(selectExport(state, owner, 'a1', ['s-lin'], 'ordinary', '', NOW));
    expect(csv.split('\r\n')[0]).toBe('"姓名","报名状态","上车点","车辆","座位","签到","去程上车","返程上车","到家"');
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('"\'  =HYPERLINK(""x"")"');
    expect(csv).not.toContain(signup(state, 's-lin').participant.phone);
    expect(csv).not.toContain('emergency');
    denied(selectExport(state, owner, 'a1', ['s-lin'], 'sensitive', '', NOW));
    const sensitive = must(selectExport(state, owner, 'a1', ['s-lin'], 'sensitive', '安全工作', NOW));
    expect(sensitive).toContain(signup(state, 's-lin').participant.emergency.phone);
    expect(sensitive).not.toContain(signup(state, 's-su').participant.emergency.phone);
    for (const name of ['+SUM(1)', '-1', '@cmd', '\ttext', '\rtext', '  @cmd']) {
      signup(state, 's-lin').participant.name = name;
      expect(must(selectExport(state, owner, 'a1', ['s-lin'], 'ordinary', '', NOW))).toContain(`"'${name}"`);
    }
  });
});

describe('notice audiences and detail states', () => {
  it('restricts activity, signup and vehicle audiences without trusting readBy', () => {
    const state = createFixture('transport', NOW);
    const notice = state.notices[0];
    notice.readBy['u-other'] = NOW;
    expect(canReadNotice(state, other, notice, NOW)).toBe(false);
    denied(auth(state, other, { type: 'notice.read', activityId: 'a1', noticeId: notice.id }));
    expect(canReadNotice(state, driver, notice, NOW)).toBe(true);
    notice.audience = { kind: 'signups', signupIds: ['s-su'] };
    expect(canReadNotice(state, zhou, notice, NOW)).toBe(true);
    expect(canReadNotice(state, staff, notice, NOW)).toBe(false);
    signup(state, 's-su').status = 'cancelled';
    expect(canReadNotice(state, zhou, notice, NOW)).toBe(true);
    const notices = selectView(state, zhou, { kind: 'notices' }, NOW);
    expect(notices).toEqual({ kind: 'notices', notices: [{ id: notice.id, activityId: 'a1', content: notice.content, publishedAt: notice.publishedAt, read: false }] });
    notice.audience = { kind: 'vehicle', vehicleId: 'v1' };
    expect(canReadNotice(state, driver, notice, NOW)).toBe(true);
    expect(canReadNotice(state, lin, notice, NOW)).toBe(true);
    expect(canReadNotice(state, other, notice, NOW)).toBe(false);
    notice.audience = { kind: 'activity' };
    signup(state, 's-lin').status = 'cancelled';
    expect(canReadNotice(state, lin, notice, NOW)).toBe(false);
    expect(activity(state, lin).permittedActions).not.toContain('attendance.home');
  });

  it('produces all twelve detail states and keeps nonparticipants out of field actions', () => {
    const state = createFixture('transport', NOW);
    expect(getDetailState(activity(state, other), NOW)).toBe('new');
    const s = signup(state, 's-lin');
    s.status = 'pending';
    expect(getDetailState(activity(state, lin), NOW)).toBe('pending');
    s.status = 'waitlisted';
    expect(getDetailState(activity(state, lin), NOW)).toBe('waitlist');
    s.status = 'confirmed';
    expect(getDetailState(activity(state, lin), NOW)).toBe('ready');
    state.assignments = state.assignments.filter((a) => a.signupId !== 's-lin');
    expect(getDetailState(activity(state, lin), NOW)).toBe('confirmed');
    s.trip = { mode: 'self' };
    expect(getDetailState(activity(state, lin), NOW)).toBe('ready');
    state.activities[0].phase = 'gathering';
    expect(getDetailState(activity(state, lin), NOW)).toBe('gathering');
    state.attendance.find((a) => a.signupId === 's-lin')!.checkIn = { method: 'manual', evidence: { at: NOW, by: 'u-lin', note: '' } };
    expect(getDetailState(activity(state, lin), NOW)).toBe('checked');
    state.activities[0].phase = 'active';
    expect(getDetailState(activity(state, lin), NOW)).toBe('active');
    expect(getDetailState(activity(state, other), NOW)).toBe('closed');
    expect(activity(state, other).permittedActions).not.toContain('attendance.checkin');
    state.activities[0].phase = 'closing';
    expect(getDetailState(activity(state, lin), NOW)).toBe('closing');
    expect(getDetailState(activity(state, other), NOW)).toBe('closed');
    state.activities[0].phase = 'archived';
    expect(getDetailState(activity(state, lin), NOW)).toBe('finished');
    state.activities[0].phase = 'cancelled';
    expect(getDetailState(activity(state, lin), NOW)).toBe('cancelled');
    state.activities[0].phase = 'published';
    s.status = 'cancelled';
    expect(getDetailState(activity(state, lin), NOW)).toBe('new');
    state.activities[0].acceptingSignups = false;
    expect(getDetailState(activity(state, lin), NOW)).toBe('closed');
  });
});
