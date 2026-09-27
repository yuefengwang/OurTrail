import {
  InstantSchema, StateSchema,
  type ActivityPhase, type ActivityRecord, type AttendanceRecord, type EvidenceRecord,
  type PersonRecord, type ProfileRecord, type RouteRecord, type State, type VehicleRecord,
} from '../domain/model';
import type { WeatherResult } from '../domain/contracts';

export const fixtureNames = [
  'empty', 'signup', 'transport', 'gathering', 'active', 'closing', 'archived', 'cross-day',
] as const;
export type FixtureName = typeof fixtureNames[number];

const syntheticNames = [
  '陆青', '江宁', '叶岚', '程远', '徐澄', '宋嘉', '罗曦', '邓宁', '唐悦',
  '谢青', '何沐', '魏然', '郑乔', '曹宇', '蒋岚', '韩朔', '陶夏', '方乐',
] as const;
const phone = (index: number): string => `000000000${String(index).padStart(2, '0')}`;

function person(name: string, index: number): PersonRecord {
  return {
    name,
    phone: phone(index),
    emergency: { name: `${name}的紧急联系人（演示）`, phone: phone(index + 50) },
    medical: '演示健康备注：无特殊情况，请按本人最新说明处理。',
  };
}

function profiles(): ProfileRecord[] {
  const fixed = [
    ['u-owner', '陈屿'], ['u-staff', '许安'], ['u-driver', '许川'], ['u-lin', '林溪'],
    ['u-zhou', '周遥'], ['u-new', '顾言'], ['u-other', '沈禾'],
  ];
  return fixed.map(([id, name], index) => ({
    id,
    person: person(name, index + 1),
    companions: id === 'u-zhou' ? [{ id: 'c-su', person: person('苏晴', 8) }] : [],
  }));
}

function route(): RouteRecord {
  return {
    id: 'r-qingcheng',
    ownerId: 'u-owner',
    title: '青城后山 · 飞泉沟轻徒步',
    distanceKm: 12.8,
    ascentM: 680,
    points: [
      { id: 'pt-taian', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.9343, lng: 103.4852 } },
      { id: 'pt-feiquan', name: '飞泉沟', kind: 'checkpoint', coordinates: { lat: 30.9508, lng: 103.4712 } },
      { id: 'pt-baiyun', name: '白云索道下站', kind: 'finish', coordinates: { lat: 30.9402, lng: 103.4786 } },
    ],
    risks: [{
      id: 'risk-rain',
      title: '雨后石阶湿滑',
      advice: '穿防滑徒步鞋，雨天放慢步速；沟谷水量增大时听从领队安排，不涉水冒进。',
    }],
  };
}

function activity(routeRecord: RouteRecord, phase: ActivityPhase, crossDay = false): ActivityRecord {
  const { id: routeId, ownerId: _ownerId, ...routeSnapshot } = routeRecord;
  const date = crossDay ? '2026-10-17' : '2026-09-26';
  return {
    id: crossDay ? 'a2' : 'a1',
    ownerId: 'u-owner',
    title: crossDay ? '青城山两日慢行' : '青城后山',
    description: '沿飞泉沟穿行山林与溪谷，按自己的节奏结伴徒步。途中统一在路线节点清点人数，安全优先。',
    organizerIntro: '陈屿带队，许安协助签到与节点确认；小队同行，互相照应。此页面为独立浏览器演示。',
    startAt: `${date}T08:00:00+08:00`,
    endAt: `${crossDay ? '2026-10-18' : date}T18:00:00+08:00`,
    deadlineAt: `${crossDay ? '2026-10-16' : '2026-09-25'}T20:00:00+08:00`,
    phase,
    acceptingSignups: phase === 'published',
    capacity: 24,
    approvalMode: 'manual',
    routeId,
    routeSnapshot,
    pickupPoints: [
      {
        id: 'p-chadianzi', name: '茶店子', meetingAt: `${date}T07:00:00+08:00`,
        address: '茶店子客运站地铁口外指定集合点（演示）', coordinates: { lat: 30.7111, lng: 104.0095 },
      },
      {
        id: 'p-xipu', name: '犀浦', meetingAt: `${date}T07:20:00+08:00`,
        address: '犀浦地铁站外指定集合点（演示）', coordinates: { lat: 30.7564, lng: 103.9703 },
      },
    ],
    equipment: ['防滑徒步鞋', '登山杖', '雨衣与防水袋', '饮用水不少于1.5升', '午餐与路餐', '个人常用药品'],
    feeNote: '¥168/人，仅为费用说明，线下与组织者确认及结算；本工具不收款、不提供支付或退款。',
    cancellationNote: '行前如需取消请及时联系组织者，费用与替补事宜线下协商；出发后退出需说明去向并确认安全到家。',
  };
}

function evidence(now: string, note: string, by = 'u-owner'): EvidenceRecord {
  return { at: now, by, note };
}

function vehicles(): VehicleRecord[] {
  return [
    {
      id: 'v1', activityId: 'a1', label: '1号中巴', plate: '川A·演示01', legalCapacity: 19,
      drivers: [{ kind: 'service', name: '许川', phone: phone(3), userId: 'u-driver' }],
      blockedSeats: 0, seatLabels: Array.from({ length: 18 }, (_, i) => String(i + 1).padStart(2, '0')),
      pickupPointIds: ['p-chadianzi', 'p-xipu'],
      legs: { outbound: { departed: null, completed: null }, return: { departed: null, completed: null } },
    },
    {
      id: 'v2', activityId: 'a1', label: '2号车', plate: '川A·演示02', legalCapacity: 7,
      drivers: [{ kind: 'service', name: '赵师傅（演示）', phone: phone(90), userId: null }],
      blockedSeats: 0, seatLabels: null, pickupPointIds: ['p-chadianzi', 'p-xipu'],
      legs: { outbound: { departed: null, completed: null }, return: { departed: null, completed: null } },
    },
  ];
}

function attendance(signupId: string): AttendanceRecord {
  return {
    signupId, checkIn: null, boardingByLeg: { outbound: null, return: null },
    returnPlan: { kind: 'assigned' }, departure: null, nodes: [], home: null,
  };
}

/** Fresh deterministic scenario data; no storage, random IDs, or wall-clock reads. */
export function createFixture(name: FixtureName, now: string): State {
  InstantSchema.parse(now);
  if (!fixtureNames.includes(name)) throw new Error(`Unknown fixture: ${name}`);
  const state: State = {
    schemaVersion: 1, revision: 0, savedAt: now, profiles: profiles(), routes: [],
    activities: [], groups: [], signups: [], vehicles: [], assignments: [], memberships: [],
    attendance: [], positions: [], incidents: [], events: [], notices: [], receipts: [],
  };
  if (name === 'empty') return StateSchema.parse(state);

  const phase: ActivityPhase = name === 'signup' || name === 'transport' || name === 'cross-day' ? 'published' : name;
  state.routes.push(route());
  state.activities.push(activity(state.routes[0], phase));
  if (name === 'cross-day') state.activities.push(activity(state.routes[0], 'published', true));
  const endAt = state.activities[0].endAt!;
  const syntheticCount = name === 'signup' ? 18 : 16;
  for (let i = 0; i < syntheticCount; i++) {
    state.profiles.push({ id: `u-walker-${String(i + 1).padStart(2, '0')}`, person: person(syntheticNames[i], i + 10), companions: [] });
  }

  const participants = [
    { signupId: 's-owner', userId: 'u-owner' },
    { signupId: 's-staff', userId: 'u-staff' },
    { signupId: 's-lin', userId: 'u-lin' },
    { signupId: 's-zhou', userId: 'u-zhou' },
    { signupId: 's-su', userId: 'u-zhou', companionId: 'c-su' },
    ...Array.from({ length: syntheticCount }, (_, i) => ({
      signupId: `s-walker-${String(i + 1).padStart(2, '0')}`, userId: `u-walker-${String(i + 1).padStart(2, '0')}`,
    })),
  ];
  participants.forEach((entry, index) => {
    const profile = state.profiles.find((p) => p.id === entry.userId)!;
    const companionId = 'companionId' in entry ? entry.companionId : undefined;
    const groupId = entry.userId === 'u-zhou' ? 'g-zhou' : `g-${entry.signupId.slice(2)}`;
    if (!state.groups.some((g) => g.id === groupId)) {
      state.groups.push({ id: groupId, activityId: 'a1', submittedByUserId: entry.userId, keepTogether: true });
    }
    state.signups.push({
      id: entry.signupId, activityId: 'a1', groupId, submittedByUserId: entry.userId,
      personRef: companionId
        ? { kind: 'companion', ownerId: entry.userId, companionId }
        : { kind: 'user', userId: entry.userId },
      participant: companionId ? profile.companions.find((c) => c.id === companionId)!.person : profile.person,
      // Zhou and Su share both pickup and vehicle as one keep-together group.
      trip: { mode: 'shared', pickupPointId: entry.userId === 'u-zhou' || index % 2 === 0 ? 'p-xipu' : 'p-chadianzi' },
      status: name !== 'signup' || index < 18 ? 'confirmed' : index < 21 ? 'pending' : 'waitlisted',
      consent: { at: now, recordedBy: entry.userId, dataUse: true, proxyAuthority: !!companionId, proxyHome: false },
    });
    state.attendance.push(attendance(entry.signupId));
  });

  state.vehicles = vehicles();
  if (name !== 'signup') {
    const assigned = name === 'transport' || name === 'cross-day' ? 15 : 21;
    for (let i = 0; i < assigned; i++) {
      // The first 12 ride v1; the next three ride v2; later confirmations fill v1.
      const inV2 = i >= 12 && i < 15;
      state.assignments.push({
        activityId: 'a1', signupId: state.signups[i].id, vehicleId: inV2 ? 'v2' : 'v1',
        seatLabel: inV2 ? null : String(i < 12 ? i + 1 : i - 2).padStart(2, '0'),
      });
    }
  }
  state.memberships = [
    {
      role: 'staff', id: 'm-staff', activityId: 'a1', userId: 'u-staff', expiresAt: endAt,
      scope: { kind: 'selected', signupIds: state.signups.slice(0, 6).map((s) => s.id) },
      capabilities: ['roster', 'checkin', 'node', 'incident', 'position', 'home'],
    },
    { role: 'vehicle_contact', id: 'm-driver', activityId: 'a1', userId: 'u-driver', expiresAt: endAt, vehicleId: 'v1' },
  ];

  const departed = ['active', 'closing', 'archived'].includes(name);
  const returning = name === 'closing' || name === 'archived';
  state.attendance.forEach((record, index) => {
    if (departed || (name === 'gathering' && index < 8)) {
      record.checkIn = { method: 'manual', evidence: evidence(now, '集合点人工签到', 'u-owner') };
    }
    if (departed) {
      record.boardingByLeg.outbound = evidence(now, '去程上车确认');
      record.departure = { kind: 'joined', evidence: evidence(now, '已随队出发') };
      record.nodes.push({ pointId: 'pt-taian', evidence: evidence(now, '起点到达确认') });
    }
    if (returning) {
      record.nodes.push({ pointId: 'pt-baiyun', evidence: evidence(now, '终点到达确认') });
      if (record.signupId === 's-su') {
        record.returnPlan = { kind: 'independent', evidence: evidence(now, '已报备自行返程') };
      } else {
        record.boardingByLeg.return = evidence(now, '返程上车确认');
      }
      if (name === 'archived' || !['s-su', 's-lin'].includes(record.signupId)) {
        const signup = state.signups[index];
        record.home = signup.personRef.kind === 'companion'
          ? evidence(now, '领队核实：已联系苏晴确认安全到家', 'u-owner')
          : evidence(now, '本人确认已安全到家', signup.personRef.userId);
      }
    }
  });
  if (departed) {
    for (const vehicle of state.vehicles) {
      vehicle.legs.outbound.departed = evidence(now, '去程车辆已发车');
      if (returning) {
        vehicle.legs.outbound.completed = evidence(now, '去程已完成');
        vehicle.legs.return.departed = evidence(now, '返程车辆已发车');
        vehicle.legs.return.completed = evidence(now, '返程车辆已完成');
      }
    }
    state.positions = state.signups.slice(0, 8).map((signup, index) => ({
      signupId: signup.id, coordinates: { lat: 30.944 + index * 0.0001, lng: 103.476 + index * 0.0001 },
      reportedAt: now, consentExpiresAt: endAt, revokedAt: null,
    }));
    state.incidents.push({
      id: 'i-su', activityId: 'a1', subjectIds: ['s-su'], kind: 'withdrawal',
      description: '苏晴已向领队报备退出同行，等待确认后续去向与安全到家。',
      opened: evidence(now, '收到退出同行报备'),
      resolution: name === 'archived' ? evidence(now, '去向已核实，本人已确认安全到家') : null,
    });
  }

  state.events.push({
    id: 'e-published', activityId: 'a1', kind: 'activity.publish', actorId: 'u-owner',
    subjectIds: [], occurredAt: now, summary: '活动已发布，请查看集合安排与装备清单。',
  });
  state.notices.push({
    id: 'n-meeting', activityId: 'a1', audience: { kind: 'activity' }, sourceEventId: 'e-published',
    content: '9月26日茶店子07:00、犀浦07:20集合。请提前10分钟到达，携带雨衣、防滑徒步鞋与饮水；分车和座位以活动页为准。',
    publishedAt: now, readBy: { 'u-owner': now }, deliveries: [],
  });
  // Parsing also separates route snapshots, profile records and signup snapshots,
  // so mutating one snapshot cannot change another record or a subsequent call.
  return StateSchema.parse(state);
}

/**
 * Offline weather simulation, never a network forecast. Dates use the activity's
 * +08:00 calendar; today through today+14 (inclusive) is supported. Unknown route
 * points or invalid dates/timestamps are unavailable. Every call returns fresh data.
 */
export function getWeather(activity: ActivityRecord, pointId: string, date: string, now: string): WeatherResult {
  if (!activity.routeSnapshot.points.some((point) => point.id === pointId)) {
    return { status: 'unavailable', message: '找不到该路线节点，暂时无法展示天气。' };
  }
  if (!InstantSchema.safeParse(now).success || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { status: 'unavailable', message: '日期或当前时间无效。' };
  }
  const day = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) {
    return { status: 'unavailable', message: '日期无效。' };
  }
  const localToday = new Date(Date.parse(now) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const distance = (day - Date.parse(`${localToday}T00:00:00Z`)) / 86_400_000;
  if (distance < 0 || distance > 14) return { status: 'out_of_range' };
  return {
    status: 'ready', updatedAt: now,
    hours: [
      { at: `${date}T08:00:00+08:00`, temperature: 18, precipitation: 0.2, wind: '东北风 6 km/h' },
      { at: `${date}T10:00:00+08:00`, temperature: 20, precipitation: 0.4, wind: '东北风 8 km/h' },
      { at: `${date}T12:00:00+08:00`, temperature: 22, precipitation: 0.6, wind: '东风 9 km/h' },
      { at: `${date}T14:00:00+08:00`, temperature: 23, precipitation: 0.8, wind: '东风 10 km/h' },
      { at: `${date}T16:00:00+08:00`, temperature: 21, precipitation: 0.4, wind: '东北风 8 km/h' },
      { at: `${date}T18:00:00+08:00`, temperature: 19, precipitation: 0.2, wind: '东北风 6 km/h' },
    ],
  };
}
