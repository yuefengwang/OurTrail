# OurTrail V1 高保真交互原型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 不自动提交 Git；仅在用户明确授权执行后开始实现。

**Goal:** 在独立 Web 工程中，用同一套合成数据跑通创建、报名、确认、交通安排、现场协作、安全收尾与归档，交付可实际操作的 OurTrail V1 高保真原型。

**Architecture:** React 页面只消费授权投影，领域命令计算完整候选状态，统一校验后先持久化、再发布给所有视图。活动执行、报名资格、交通安排和个人履约分开建模；单标签页内切换演示账号共享同一业务状态。

**Tech Stack:** React 19、TypeScript、Vite 8、React Router 7.18.2、Zod 4、Vitest 5、Testing Library、Playwright；CSS tokens、系统字体、内联 SVG、localStorage 合成快照。

---

## 0. 批准依据、交付性质与执行边界

- **设计批准：** 用户于 2026-09-24 明确回复“确认设计评审稿，进入实现计划”。批准基线为 `D:/OurTrail/docs/prototypes/ourtrail-v1-design-review.html`，包括三入口、活动工作台、14 个布局方向及 R1–R4。
- **本文件是实施计划，不是已完成实现。** 文中的命令、测试、接口和算法均面向后续执行；本轮未创建原型工程、未安装项目依赖、未运行业务测试。
- 基线文件中的“待确认”是评审时的历史措辞；不重新问 R1–R4，也不改写已批准的基线。
- 唯一新工程根目录记为 **APP = `D:/OurTrail/docs/prototypes/ourtrail-app`**。下文 `src/`、`tests/` 等路径均相对于 APP，不是项目根目录。
- 不修改 `miniprogram/`、`cloudfunctions/`、微信配置、五份版本规格、两份 ADR、旧低保真或评审 HTML；不部署云资源，不迁移生产数据，不自动 Git 初始化或提交。
- 完整 V1 含 V1.0–V1.2 的四种视角；不伪称四角色都属 V1.0。
- 不增加公开发现、搭子撮合、司机报价/订单、支付、保险、救援承诺、完整 IM、持续定位、俱乐部主页/租户后台或公开路线库。
- 本地服务仅绑定 `127.0.0.1`。所有人名、电话、健康资料、车牌、天气、坐标都是合成样本；界面固定显示“演示原型，请勿输入真实个人信息”。联系人操作只复制示例文字，不拨打样例号码。
- 单标签页共享状态不等于真实多用户协作。分享链接可定位活动，但另一浏览器没有本地新建数据时须显示不存在，不能声称对方已收到报名。前端权限验证不是生产安全边界。
- 计划新增的技术表达不是新增产品决策；下文逐项说明如何把已批准规则变成可测试约束。

### 0.1 完成定义

1. 14 个布局方向都有可进入的页面/状态，12 个详情状态从领域事实派生，不是手动选择一个截图状态。
2. 每个业务按钮有实际命令、显式错误和可观察结果；只有复制、导航等纯交互允许不改领域状态。
3. 参与者、领队、协作、车辆联系人看到相同活动事实，但不同字段范围。
4. 任意失败均无半次报名、半次换座或假到家；存储失败不得先显示成功。
5. 完整生命周期、关键边界、类型检查、构建、浏览器交互和响应式均有执行证据。
6. 微信登录、订阅、地图导航、真实定位、真实天气及合规留存明确列为未验证，不以 Web 演示替代真机联调。

## 1. 现状结构与病灶：引用只描述当前代码

| 已核实的现状 | 文件证据 | 本原型的处理 |
|---|---|---|
| 以开始日期早于今天判“已结束”，无法表达跨天执行与安全收尾 | `D:/OurTrail/miniprogram/pages/activity/activity.js:39–48,74` | 带时区起止时间 + 显式 phase；日期只提醒，不改阶段 |
| 取消按钮取消本人及全部代报者 | `D:/OurTrail/miniprogram/pages/activity/activity.js:108–117` | 单人取消与明确整组取消分开；同事务释放分配 |
| 管理页分别派生车辆人数、签到、到家，报名资格只有 active 这一层 | `D:/OurTrail/miniprogram/pages/manage/manage.js:43–59,111–117` | 统一 selectors；pending/confirmed/waitlisted 与履约分离 |
| 最后位置超过 30 分钟标灰 | `D:/OurTrail/miniprogram/pages/manage/manage.js:74–86` | 保留为新鲜度提示，不解释为失联；加入授权/撤回/阶段过滤 |
| 自助签到已有无定位的执行路径 | `D:/OurTrail/miniprogram/pages/activity/activity.js:123–141` | 不强绑定位；人工核实需依据，不伪造 GPS 成功 |
| 现有小程序仅七页，无 Tab Bar | `D:/OurTrail/miniprogram/app.json:2–10` | 独立 Web 三入口，不修改原生导航 |
| 旧低保真共用发起/管理底栏，提交主要改 DOM | `D:/OurTrail/docs/prototypes/v1-wechat-miniprogram-prototype.html:72,82` | 不继续换皮；所有页面共用状态与命令 |
| 评审样张明确不执行业务 | `D:/OurTrail/docs/prototypes/ourtrail-v1-design-review.html:59–63` | 作为视觉基线，不复制其静态计数和 HTML 字符串 |
| 车辆任务禁止接触医疗和紧急联系人 | `D:/OurTrail/docs/prototypes/ourtrail-v1-design-review.html:47–48,75` | 白名单构造车辆视图与导出，不能先传全量再隐藏 |

当前 APP 不存在，项目不是 Git 仓库；没有可复用的 Web dev/build/test 配置。以上病灶用于新原型设计，不代表本轮修复了旧小程序。

## 2. 文件边界与依赖顺序

### 2.1 拟新增文件清单

所有文件均位于 APP；**现有产品文件改写 0、删除 0**。规模为估算，不作为凑代码指标。

| 文件（每项列出确切路径） | 职责 | 预计行数合计 |
|---|---|---:|
| `package.json`, `package-lock.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `.gitignore` | 独立构建、测试与本地服务；锁文件不计源码规模 | 110–170 |
| `src/domain/model.ts`, `src/domain/contracts.ts` | 唯一持久化 schema、派生类型、命令与结果契约 | 420–620 |
| `src/domain/commands.ts`, `src/domain/invariants.ts` | 命令入口、幂等、候选快照、全局约束 | 220–340 |
| `src/domain/activity.ts`, `src/domain/signup.ts`, `src/domain/transport.ts`, `src/domain/field.ts`, `src/domain/notices.ts`, `src/domain/profile.ts` | 六类聚合变更，不含浏览器 API | 900–1400 |
| `src/domain/permissions.ts`, `src/domain/selectors.ts`, `src/domain/allocation.ts` | 关系鉴权、白名单视图、纯分车算法 | 450–700 |
| `src/data/fixtures.ts`, `src/data/store.ts` | 合成场景与先保存后发布的状态源 | 300–450 |
| `src/app/runtime.ts`, `src/app/useView.ts`, `src/app/navigation.tsx`, `src/App.tsx`, `src/main.tsx` | 演示账号/时钟、授权订阅、Hash 路由、应用装配 | 250–380 |
| `src/components/AppShell.tsx`, `src/components/ActivityCard.tsx`, `src/components/PersonRow.tsx`, `src/components/Overlay.tsx`, `src/components/StatusPanel.tsx`, `src/components/FormField.tsx`, `src/components/Icon.tsx` | 页面骨架、名单行、共用 dialog/sheet 基础、表单和图标 | 380–600 |
| `src/screens/ActivityHome.tsx`, `src/screens/ActivityDetail.tsx`, `src/screens/Signup.tsx`, `src/screens/ActivityEditor.tsx`, `src/screens/Workspace.tsx` | 首页、详情、报名、创建和工作台壳 | 550–850 |
| `src/screens/Roster.tsx`, `src/screens/Transport.tsx`, `src/screens/Field.tsx`, `src/screens/StaffTask.tsx`, `src/screens/VehicleTask.tsx` | 工作区子屏与两个受限任务屏 | 650–950 |
| `src/screens/Weather.tsx`, `src/screens/Notices.tsx`, `src/screens/Profile.tsx` | 公共任务页；收尾复用 Field，不另造一套名单 | 350–550 |
| `src/styles/tokens.css`, `src/styles/base.css`, `src/styles/components.css` | 原始/语义/组件 token、移动端和状态样式 | 280–420 |
| `tests/setup.ts`, `tests/helpers.ts`, `tests/model.test.ts`, `tests/permissions.test.ts`, `tests/store.test.ts`, `tests/activity.test.ts`, `tests/signup.test.ts`, `tests/allocation.test.ts`, `tests/transport.test.ts`, `tests/notices.test.ts`, `tests/field.test.ts`, `tests/privacy.test.ts`, `tests/lifecycle.test.ts`, `tests/ui.test.tsx`, `tests/navigation.test.tsx`, `tests/e2e/prototype.spec.ts` | 领域、权限、存储、组件与浏览器回归 | 1100–1650 |

源代码约 4800–7500 行，测试约 1100–1650 行；锁文件另计。比评审的文件组更细，是为了拆开领域变更与工作台子屏，不增加产品模块。实际交付报告实测文件/行数，不照抄估算。

### 2.2 依赖图与可并行边界

```text
T01 工程 → T02 模型/样本 → T03 权限 → T04 命令/存储
                                         ├→ T05 活动 → T06 报名 → T07 交通
                                         ├→ T08 通知/导出
                                         └→ T09 履约/安全 → T10 隐私/个人资料
T01 → T11 视觉与组件
T04 + T11 → T12 路由/运行时
T05–T08 + T12 → T13 参与者与组织者页面
T09–T10 + T13 → T14 现场/任务页/公共页
T01–T14 → T15 领域闭环与边界 → T16 浏览器/视觉/交付
```

可并行：T11 与领域任务；T08 与 T07。`model.ts`、`contracts.ts`、`commands.ts`、`fixtures.ts` 由同一个执行者维护；不得让多个子任务同时写共享文件。每一批先核契约，再执行，不能把未验证 Agent 摘要当交付证据。

## 3. 数据结构：单一事实来源

### 3.1 结构选择与不变量

| 结构 | 选择及原因 | 明确不用什么 |
|---|---|---|
| `State.revision` | 一个本地快照版本；所有命令带 expectedRevision，分车预览保存 baseRevision | 不同时存 Activity/Assignment 多级版本，避免单标签页里互相漂移；其他活动的写入也使旧预览失效，代价是重算一次 |
| `SignupGroup` + `Signup` | 同行意愿属组；每个人资格、交通、履约独立 | 不以一个 group.status 代表所有人 |
| `PersonRef` | user 或提交者管理的 companion；手机/姓名不是唯一身份 | 不凭同名或共用家长电话静默合并人员 |
| `Trip` 联合类型 | 自行到达 / 统一乘车带上车点 | 不允许自行到达却残留 pickupPointId |
| `Vehicle.drivers` | 参与者司机关联 Signup；纯服务司机只占司机位 | 不另存 driverCount/passengerCapacity，也不为参与者司机分乘客座 |
| `Membership` 联合类型 | staff 有分管与能力；vehicle_contact 只能指向一辆车 | 不给司机一个可随意塞入 sensitive 权限的通用 capability 列表；车辆联系人关系只存一处 |
| `Attendance` | 签到、两程上车、出发结果、节点、到家，各是一种事实 | 不把签到当上车，不在 assignment 双写 boarding |
| `Incident` + `ActivityEvent` | 异常有解决状态；事件是不可改的操作摘要 | 不靠搜索自由文本判断异常是否关闭，不复制医疗资料到事件 |
| `Notice` | 发布对象、受众、已读、外发记录分开 | 不把发布、复制或模拟外发当已读 |
| `StateSchema` + `z.infer` | 持久化解析与 TS 形状同源；本地缓存也是输入边界 | 不用 `JSON.parse(raw) as State` 或另写一套不完整类型守卫 |

无数据库、无 DDL、无云集合创建。下述记录是本地合成快照的唯一模型；将来生产迁移另设计事务、鉴权、索引、留存和并发，不能直接上传此快照。

### 3.2 `src/domain/model.ts` 的 schema 与类型骨架

以下是完整字段契约；通过 schema 后还必须执行 §5 的跨记录约束。所有时间保存带偏移的 ISO 字符串，展示统一 `Asia/Shanghai`；不在领域函数里隐式调用系统时间。

```ts
import { z } from 'zod';

const Id = z.string().min(1).max(120);
const Text = z.string().max(2000);
const Instant = z.string().datetime({ offset: true });
const Count = z.number().int().nonnegative();
const Coordinates = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const Contact = z.object({ name: Text, phone: Text });
const Person = z.object({
  name: Text, phone: Text, emergency: Contact,
  medical: Text,
});
const PersonRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: Id }),
  z.object({ kind: z.literal('companion'), ownerId: Id, companionId: Id }),
]);
const Profile = z.object({
  id: Id, person: Person,
  companions: z.array(z.object({ id: Id, person: Person })),
});
const RoutePoint = z.object({
  id: Id, name: Text,
  kind: z.enum(['start', 'checkpoint', 'finish']),
  coordinates: Coordinates.nullable(),
});
const RouteRisk = z.object({ id: Id, title: Text, advice: Text });
const Route = z.object({
  id: Id, ownerId: Id, title: Text,
  distanceKm: z.number().nonnegative(), ascentM: Count,
  points: z.array(RoutePoint), risks: z.array(RouteRisk),
});
const PickupPoint = z.object({
  id: Id, name: Text, meetingAt: Instant.nullable(),
  address: Text, coordinates: Coordinates.nullable(),
});
export const PhaseSchema = z.enum([
  'draft', 'published', 'gathering', 'active', 'closing', 'archived', 'cancelled',
]);
const Activity = z.object({
  id: Id, ownerId: Id, title: Text, description: Text, organizerIntro: Text,
  startAt: Instant.nullable(), endAt: Instant.nullable(), deadlineAt: Instant.nullable(),
  phase: PhaseSchema, acceptingSignups: z.boolean(),
  capacity: z.number().int().min(1).max(500),
  approvalMode: z.enum(['manual', 'automatic']),
  routeId: Id.nullable(), routeSnapshot: Route.omit({ id: true, ownerId: true }),
  pickupPoints: z.array(PickupPoint), equipment: z.array(Text),
  feeNote: Text, cancellationNote: Text,
});
export const TripSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('self') }),
  z.object({ mode: z.literal('shared'), pickupPointId: Id }),
]);
const Consent = z.object({
  at: Instant, recordedBy: Id, dataUse: z.literal(true),
  proxyAuthority: z.boolean(), proxyHome: z.boolean(),
});
const SignupGroup = z.object({
  id: Id, activityId: Id, submittedByUserId: Id, keepTogether: z.boolean(),
});
export const SignupSchema = z.object({
  id: Id, activityId: Id, groupId: Id, submittedByUserId: Id,
  personRef: PersonRef, participant: Person, trip: TripSchema,
  status: z.enum(['pending', 'confirmed', 'waitlisted', 'rejected', 'cancelled', 'removed']),
  consent: Consent,
});
const Driver = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('participant'), signupId: Id }),
  z.object({ kind: z.literal('service'), name: Text, phone: Text, userId: Id.nullable() }),
]);
const Evidence = z.object({ at: Instant, by: Id, note: Text });
export const ReturnPlanSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('assigned') }),
  z.object({ kind: z.literal('independent'), evidence: Evidence }),
]);
const VehicleLeg = z.object({ departed: Evidence.nullable(), completed: Evidence.nullable() });
const Vehicle = z.object({
  id: Id, activityId: Id, label: Text, plate: Text,
  legalCapacity: z.number().int().min(1).max(60),
  drivers: z.array(Driver).min(1), blockedSeats: Count,
  seatLabels: z.array(z.string().min(1).max(12)).nullable(),
  pickupPointIds: z.array(Id),
  legs: z.object({ outbound: VehicleLeg, return: VehicleLeg }),
});
const Assignment = z.object({
  activityId: Id, signupId: Id, vehicleId: Id, seatLabel: z.string().nullable(),
});
const Scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('selected'), signupIds: z.array(Id) }),
]);
export const MembershipSchema = z.discriminatedUnion('role', [
  z.object({
    id: Id, activityId: Id, userId: Id, role: z.literal('staff'), expiresAt: Instant,
    scope: Scope,
    capabilities: z.array(z.enum(['roster', 'checkin', 'node', 'incident', 'position', 'home', 'sensitive'])),
  }),
  z.object({
    id: Id, activityId: Id, userId: Id, role: z.literal('vehicle_contact'),
    vehicleId: Id, expiresAt: Instant,
  }),
]);
const Departure = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('joined'), evidence: Evidence }),
  z.object({ kind: z.literal('not_departed'), evidence: Evidence }),
  z.object({ kind: z.literal('coordinating'), evidence: Evidence }),
]);
const CheckIn = z.discriminatedUnion('method', [
  z.object({ method: z.literal('simulation'), evidence: Evidence, coordinates: Coordinates }),
  z.object({ method: z.literal('manual'), evidence: Evidence }),
]);
const Attendance = z.object({
  signupId: Id, checkIn: CheckIn.nullable(),
  boardingByLeg: z.object({ outbound: Evidence.nullable(), return: Evidence.nullable() }),
  returnPlan: ReturnPlanSchema,
  departure: Departure.nullable(),
  nodes: z.array(z.object({ pointId: Id, evidence: Evidence })),
  home: Evidence.nullable(),
});
const PositionReport = z.object({
  signupId: Id, coordinates: Coordinates, reportedAt: Instant,
  consentExpiresAt: Instant, revokedAt: Instant.nullable(),
});
const Incident = z.object({
  id: Id, activityId: Id, subjectIds: z.array(Id).min(1),
  kind: z.enum(['late', 'withdrawal', 'injury', 'other']),
  description: Text, opened: Evidence, resolution: Evidence.nullable(),
});
const ActivityEvent = z.object({
  id: Id, activityId: Id, kind: Text, actorId: Id,
  subjectIds: z.array(Id), occurredAt: Instant, summary: Text,
});
const Audience = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('activity') }),
  z.object({ kind: z.literal('signups'), signupIds: z.array(Id).min(1) }),
  z.object({ kind: z.literal('vehicle'), vehicleId: Id }),
]);
const Delivery = z.object({
  id: Id, channel: z.enum(['copy', 'subscription_simulation']),
  status: z.enum(['copied', 'simulated_success', 'failed', 'not_authorized']),
  at: Instant, by: Id, detail: Text,
});
const Notice = z.object({
  id: Id, activityId: Id, audience: Audience, sourceEventId: Id.nullable(),
  content: Text, publishedAt: Instant,
  readBy: z.record(Id, Instant), deliveries: z.array(Delivery),
});
const Receipt = z.object({
  actorId: Id, requestId: Id, fingerprint: Text,
  targetIds: z.array(Id), appliedAt: Instant,
});
export const StateSchema = z.object({
  schemaVersion: z.literal(1), revision: Count, savedAt: Instant,
  profiles: z.array(Profile), routes: z.array(Route), activities: z.array(Activity),
  groups: z.array(SignupGroup), signups: z.array(SignupSchema),
  vehicles: z.array(Vehicle), assignments: z.array(Assignment),
  memberships: z.array(MembershipSchema), attendance: z.array(Attendance),
  positions: z.array(PositionReport), incidents: z.array(Incident),
  events: z.array(ActivityEvent), notices: z.array(Notice), receipts: z.array(Receipt),
});
export type State = z.infer<typeof StateSchema>;
export type ActivityPhase = z.infer<typeof PhaseSchema>;
export type ActivityRecord = State['activities'][number];
export type SignupRecord = State['signups'][number];
export type SignupGroupRecord = State['groups'][number];
export type VehicleRecord = State['vehicles'][number];
export type AssignmentRecord = State['assignments'][number];
export type MembershipRecord = State['memberships'][number];
export type AttendanceRecord = State['attendance'][number];
export type NoticeRecord = State['notices'][number];
export type ProfileRecord = State['profiles'][number];
export type Trip = z.infer<typeof TripSchema>;
export type PersonRecord = z.infer<typeof Person>;
export type PersonReference = z.infer<typeof PersonRef>;
export type RouteRecord = State['routes'][number];
export type EvidenceRecord = z.infer<typeof Evidence>;
export type CoordinatesRecord = z.infer<typeof Coordinates>;
export type AudienceRecord = z.infer<typeof Audience>;
export type DepartureRecord = z.infer<typeof Departure>;
export type CheckInRecord = z.infer<typeof CheckIn>;
```

`Receipt.fingerprint` 不保存表单原文；使用 §4 的规范化 SHA-256 摘要，避免幂等表复制医疗/电话。`Text` 的长度上限仅是原型输入边界，不是生产数据标准。日期为 null 只允许草稿；发布后的完整性由 invariants 保证。

### 3.3 合成样本与时间

`fixtures.ts` 导出 `createFixture(name, now): State`，name 为 `empty | signup | transport | gathering | active | closing | archived | cross-day`。每次返回独立深拷贝；除用户主动重置外，不因切换页面/账号重建数据。

固定测试时间 `2026-09-24T07:00:00+08:00`；样本活动 `a1` 为 09/26 青城后山，`a2` 为 10/17–18 跨天活动。首次演示时钟固定在样本合适阶段，可在独立“演示工具”推进时间；同时显示“演示时间”，不得伪装手机当前时间。真实 `Date.now()` 只用于运行时，不进入测试期待值。

| 稳定 ID | 合成对象 | 关系 |
|---|---|---|
| `u-owner` | 陈屿 | a1 发起者；transport 及之后样本中有确认报名 `s-owner` |
| `u-staff` | 许安 | a1 后队协作；有确认报名 `s-staff`，授权只含分管范围 |
| `u-driver` | 许川 | `v1` 车辆联系人、纯驾驶服务者，不占活动名额 |
| `u-lin` | 林溪 | 已有本人报名 `s-lin`；可切到该账号看个人投影 |
| `u-zhou` | 周遥 | 提交者；本人 `s-zhou`、代报苏晴 `s-su`，同行组 `g-zhou` |
| `u-new` | 顾言 | signup 样本尚未报名，用于提交测试 |
| `u-other` | 沈禾 | 无 a1 工作授权，用于旧链接/越权测试 |
| `v1` | 1号中巴 | 核载19，服务司机1，不可用0，可用18，座号01–18，两个上车点 |
| `v2` | 2号车 | 核载7，服务司机1，不可用0，可用6，可不编号 |
| `p-chadianzi`, `p-xipu` | 两个上车点 | 07:00 / 07:20，统一 Asia/Shanghai |

`signup` 样本：capacity=24，18 confirmed + 3 pending，waitlisted=2；林溪包含在18人中。`transport`：21 confirmed，只有15人已有分配，6人待分配；车辆总乘客位24。其余人员使用固定合成姓名数组，按序生成 ID，禁止每次随机生成导致断言不稳定。

`gathering` 保持21确认、部分签到未上车。`active` 有21名实际出行者（含领队和协作），仅8条未撤回位置、1条未结异常。`closing` 有21出行、19到家、苏晴及林溪未到家、苏晴1条下撤异常未解决。`archived` 无待核实人员与未结异常。每个样本必须先过 StateSchema 和 assertInvariants，不能为了展示数字制造非法状态。

天气不是 State 内的业务事实：`fixtures.ts` 另导出按活动关键点/日期索引的固定 `WeatherResult`，有 ready、out_of_range、unavailable 三种结果；数值和更新时间均标“模拟”。单个样本不随重复点击变成随机天气。

## 4. 命令、返回值和页面接口

### 4.1 `src/domain/contracts.ts` 核心签名

所有业务改动只走 `reduceCommand`；不允许组件直接改数组。外部输入先做字段/schema 校验；对象存在性、跨活动引用、名额、权限仍在命令层验证。

```ts
import type {
  State, ActivityRecord, ActivityPhase, SignupRecord, Trip,
  VehicleRecord, MembershipRecord, PersonRecord, PersonReference,
  CheckInRecord, DepartureRecord, CoordinatesRecord, AudienceRecord,
  AssignmentRecord, ProfileRecord,
} from './model';

export type Actor = { userId: string | null };
export type Context = { now: string; id: (kind: string) => string };
export type ParticipantInput = {
  personRef: PersonReference;
  participant: PersonRecord;
  trip: Trip;
  consent: { dataUse: boolean; proxyAuthority: boolean; proxyHome: boolean };
};
export type ActivityInput = Omit<ActivityRecord, 'id' | 'ownerId' | 'phase'>;
export type VehicleInput = Omit<VehicleRecord, 'id' | 'activityId' | 'legs'>;
export type AssignmentTarget = { signupId: string; vehicleId: string; seatLabel: string | null };
export type AssignmentPreview = {
  activityId: string; baseRevision: number; assignments: AssignmentRecord[];
  unassigned: { signupId: string; reason: 'no_vehicle' | 'pickup_mismatch' | 'group_too_large' | 'no_seat' }[];
};
export type Payload =
  | { type: 'activity.create'; input: ActivityInput }
  | { type: 'activity.edit'; activityId: string; input: ActivityInput }
  | { type: 'activity.copy'; sourceActivityId: string }
  | { type: 'activity.publish'; activityId: string; participation: ParticipantInput | null }
  | { type: 'activity.transition'; activityId: string; next: ActivityPhase; reason: string }
  | { type: 'signup.submit'; activityId: string; participants: ParticipantInput[]; keepTogether: boolean; mode: 'apply' | 'waitlist' }
  | { type: 'signup.review'; activityId: string; signupIds: string[]; decision: 'confirm' | 'reject' }
  | { type: 'signup.promote'; activityId: string; signupIds: string[] }
  | { type: 'signup.cancel'; activityId: string; signupIds: string[]; reason: string }
  | { type: 'signup.edit'; activityId: string; signupId: string; participant: PersonRecord; trip: Trip; purpose: string }
  | { type: 'group.setTogether'; activityId: string; groupId: string; keepTogether: boolean }
  | { type: 'vehicle.save'; activityId: string; vehicleId: string | null; input: VehicleInput }
  | { type: 'vehicle.remove'; activityId: string; vehicleId: string }
  | { type: 'assignment.commit'; activityId: string; preview: AssignmentPreview }
  | { type: 'assignment.set'; activityId: string; target: AssignmentTarget }
  | { type: 'assignment.remove'; activityId: string; signupId: string }
  | { type: 'assignment.swap'; activityId: string; firstSignupId: string; secondSignupId: string }
  | { type: 'membership.save'; activityId: string; membership: MembershipRecord }
  | { type: 'membership.revoke'; activityId: string; membershipId: string }
  | { type: 'attendance.checkin'; activityId: string; signupId: string; checkIn: CheckInRecord }
  | { type: 'attendance.board'; activityId: string; signupId: string; leg: 'outbound' | 'return'; boarded: boolean; note: string }
  | { type: 'attendance.departure'; activityId: string; signupId: string; outcome: DepartureRecord }
  | { type: 'attendance.returnPlan'; activityId: string; signupId: string; plan: 'assigned' | 'independent'; note: string }
  | { type: 'attendance.node'; activityId: string; signupId: string; pointId: string; note: string }
  | { type: 'attendance.home'; activityId: string; signupId: string; note: string }
  | { type: 'vehicle.depart'; activityId: string; vehicleId: string; leg: 'outbound' | 'return'; note: string }
  | { type: 'vehicle.complete'; activityId: string; vehicleId: string; leg: 'outbound' | 'return'; note: string }
  | { type: 'position.report'; activityId: string; signupId: string; coordinates: CoordinatesRecord; consent: boolean }
  | { type: 'position.revoke'; activityId: string; signupId: string }
  | { type: 'incident.report'; activityId: string; signupIds: string[]; kind: 'late' | 'withdrawal' | 'injury' | 'other'; description: string }
  | { type: 'incident.resolve'; activityId: string; incidentId: string; note: string }
  | { type: 'notice.publish'; activityId: string; audience: AudienceRecord; content: string }
  | { type: 'notice.read'; activityId: string; noticeId: string }
  | { type: 'notice.delivery'; activityId: string; noticeId: string; channel: 'copy' | 'subscription_simulation'; status: 'copied' | 'simulated_success' | 'failed' | 'not_authorized'; detail: string }
  | { type: 'export.record'; activityId: string; signupIds: string[]; mode: 'ordinary' | 'sensitive'; purpose: string }
  | { type: 'profile.save'; person: PersonRecord }
  | { type: 'companion.save'; companionId: string | null; person: PersonRecord }
  | { type: 'companion.remove'; companionId: string };

export type Command = {
  actor: Actor; requestId: string; expectedRevision: number;
  fingerprint: string; payload: Payload;
};
export type ErrorCode =
  | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_INPUT'
  | 'WRONG_PHASE' | 'CONFLICT' | 'REQUEST_REUSED' | 'CAPACITY'
  | 'DUPLICATE_PERSON' | 'GROUP_SCOPE' | 'VEHICLE_FULL' | 'SEAT_TAKEN'
  | 'PICKUP_MISMATCH' | 'DRIVER_CONFLICT' | 'UNRESOLVED_DEPARTURE'
  | 'UNRESOLVED_SAFETY' | 'CONSENT_REQUIRED' | 'STORAGE_UNAVAILABLE'
  | 'OFFLINE' | 'CORRUPT_SNAPSHOT';
export type DomainError = {
  code: ErrorCode; message: string; fieldErrors?: Record<string, string>;
};
export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };
export type Applied = { state: State; targetIds: string[]; replayed: boolean };
export type DispatchResult = Result<{ targetIds: string[]; replayed: boolean }>;
export type Perspective = 'participant' | 'organizer' | 'staff' | 'vehicle';
export type ReadRequest =
  | { kind: 'home'; perspective: Perspective; openedActivityIds: string[] }
  | { kind: 'activity'; activityId: string; perspective: Perspective; vehicleId?: string; selectedSignupId?: string }
  | { kind: 'notices'; activityId?: string }
  | { kind: 'profile' };
export type PersonRowView = {
  signupId: string; groupId: string; name: string; status: SignupRecord['status'];
  pickup: string; vehicle: string; seat: string | null;
  checkedIn: boolean; outboundBoarded: boolean; returnBoarded: boolean;
  departure: 'unknown' | 'joined' | 'not_departed' | 'coordinating'; home: boolean;
};
export type ActivityView = {
  kind: 'activity'; activity: ActivityRecord; perspective: Perspective;
  primarySignupId: string | null;
  rows: PersonRowView[]; counters: {
    confirmed: number; pending: number; occupied: number; waitlisted: number;
    remaining: number; unassigned: number; unchecked: number; pendingHome: number; openIncidents: number;
  };
  permittedActions: Payload['type'][];
  vehicleTask: null | {
    vehicle: VehicleRecord;
    passengers: (PersonRowView & { phone: string })[];
  };
  positions: { signupId: string; name: string; coordinates: CoordinatesRecord; reportedAt: string; stale: boolean }[];
  incidents: { id: string; subjectIds: string[]; kind: string; description: string; resolved: boolean }[];
};
export type AuthorizedView =
  | ActivityView
  | { kind: 'home'; activities: ActivityRecord[] }
  | { kind: 'notices'; notices: { id: string; activityId: string; content: string; publishedAt: string; read: boolean }[] }
  | { kind: 'profile'; profile: ProfileRecord }
  | { kind: 'denied'; code: 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND'; message: string };
export type SensitiveView = { signupId: string; emergency: PersonRecord['emergency']; medical: string };
export type SignupFormView = { signupId: string; groupId: string; input: ParticipantInput };
export type TransportView = {
  vehicles: VehicleRecord[]; assignments: AssignmentRecord[];
  groups: { id: string; keepTogether: boolean; signupIds: string[] }[];
};
export type AccessView = { memberships: MembershipRecord[] };
export type NoticeManagementView = { notices: State['notices'] };
export type WeatherResult =
  | { status: 'ready'; updatedAt: string; hours: { at: string; temperature: number; precipitation: number; wind: string }[] }
  | { status: 'out_of_range' }
  | { status: 'unavailable'; message: string };

export function canonicalPayload(payload: Payload): string {
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value)
        .sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0)
        .map(([key, item]) => [key, normalize(item)]));
    }
    return value;
  }
  return JSON.stringify(normalize(payload));
}
```

边界说明：`ActivityView.activity` 不含报名个人信息；草稿仅拥有者可见。事件、通知与异常正文只能输入本场协作所需信息，不能粘贴医疗档案；参与者只看到涉及本人/授权代报者的异常，车辆视图的 incidents 与 positions 恒为空。电话号码不进入通用 PersonRowView，联系方式面板单独按用途读取。视图默认不含 `SensitiveView`。

对上述边界实现下列函数，参数顺序全计划保持一致：

```ts
reduceCommand(state: State, command: Command, context: Context): Result<Applied>;
assertInvariants(state: State): Result<null>;
canExecute(state: State, actor: Actor, payload: Payload, now: string): Result<null>;
selectView(state: State, actor: Actor, request: ReadRequest, now: string): AuthorizedView;
selectSensitive(state: State, actor: Actor, activityId: string, signupId: string, purpose: string, now: string): Result<SensitiveView>;
selectContact(state: State, actor: Actor, activityId: string, signupId: string, now: string): Result<{ name: string; phone: string }>;
selectExport(state: State, actor: Actor, activityId: string, signupIds: string[], mode: 'ordinary' | 'sensitive', purpose: string, now: string): Result<string>;
planAssignments(state: State, actor: Actor, activityId: string, now: string): Result<AssignmentPreview>;
passengerCapacity(vehicle: VehicleRecord): number;
getDetailState(view: ActivityView, now: string): 'new' | 'pending' | 'confirmed' | 'ready' | 'gathering' | 'checked' | 'active' | 'closing' | 'finished' | 'waitlist' | 'closed' | 'cancelled';
```

这是签名清单，不直接将这些无函数体的行粘成 `.ts` 实现。各实现文件导入契约类型；六个领域文件统一导出 `(candidate, command, context) => Result<string[]>` 的处理函数，只修改私有候选快照，返回目标 ID；页面不能调用这些内部处理函数。

### 4.2 幂等、版本与输入归一化

1. 运行时先按字段 schema 解析 payload；电话号码在字段校验前 trim，姓名 trim，电话号码验证只作格式提醒，不作为身份主键。
2. `canonicalPayload` 递归对对象键排序，数组保留顺序，拒绝 undefined/NaN/循环对象；payload 来自 schema 的 JSON 数据，不接受函数和任意对象。
3. 用 Web Crypto `SHA-256` 计算 canonical JSON，命令只携带摘要。测试用 Node `createHash('sha256')` 对同一规范串计算，不记录明文指纹。
4. 同一请求的重试保留 requestId、payload 与 fingerprint。表单内容修改后才生成新 requestId。网络错误和存储错误均不得改写请求 ID 冒充新业务动作。
5. 幂等键为 `actorId + requestId`。先检查当前身份和资源关系，再查 receipt；同键同指纹直接返回 targetIds，**不重播旧敏感视图、不增加 revision、不追加事件**；同键不同指纹返回 REQUEST_REUSED。
6. receipt 命中先于阶段/版本校验，保证成功报名或取消后的重试仍然幂等。资源授权被撤销后，不通过旧 receipt 绕过鉴权。
7. 新请求检查 expectedRevision；不匹配返回 CONFLICT。UI 保留输入并显示最新事实，用户明确重新提交时用新 revision；不能自动重放旧换座/取消指令。
8. id 与 now 由 Context 注入。记录 Evidence 时使用 context.now 和 actor.userId 覆盖客户端传入的 at/by，拒绝伪造操作人；note 保留经校验内容。

## 5. 流程、事务、失败语义与成本

### 5.1 唯一写路径

```text
界面填写并校验 → 捕获 revision/账号 → 生成或复用请求 ID
  → 计算指纹 → store.dispatch（校验此时仍是原账号）
  → 检查可写/网络演示状态
  → reduceCommand：关系鉴权 → receipt → revision → 阶段/业务规则
  → structuredClone(state) 得到候选
  → 对候选执行全部相关变更 + 事件 + 必要站内通知 + receipt
  → StateSchema.safeParse + assertInvariants
  → Storage.setItem(整个快照)
  → 更新 store 当前引用 → 通知订阅者 → 页面显示结果
```

严禁在 reducer 或渲染函数中访问 localStorage、剪贴板、网络、系统时间；严禁先改 React 计数再异步“尽量保存”。外发通知和剪贴板是另一笔操作，失败不撤销已发布的活动事实。

### 5.2 核心约束清单（每次候选提交前）

- ID 在各自集合唯一；活动内资源外键同场有效；signup 与 group 的 activityId/提交者一致；每位 signup 恰好一条 Attendance。历史 Signup 的 companion PersonRef 是身份来源标识，不要求常用同行人条目继续存在：删除条目后保留 PersonRef 与 participant 快照，不复用旧 companionId；新增报名引用 companion 时仍须验证条目存在且属于提交者。
- 同场相同 PersonRef 最多一条 pending/confirmed/waitlisted 报名。已取消后可重新报名，但新旧履约记录不混用。
- pending + confirmed ≤ capacity；waitlisted 不占位；remaining 不做负数截断掩盖超卖。
- 车辆乘客位 = legalCapacity − drivers.length − blockedSeats，必须 ≥0；座号非空、唯一；编号车 seatLabels 数量等于可用乘客位。
- Assignment 只引用 confirmed、shared 且非参与者司机；每人最多一辆车；点位必须被该车服务；每个编号座位唯一；编号车允许已分车未编号，占容量但不占某个具体号。
- 参与者司机必须是同场 confirmed，每位司机不能同时开两车；不再分配乘客座。其原报名 trip 不删除，用作集合信息；unassigned 排除该人。
- staff scope/vehicle_contact 指向本场现存资源；同车同一时刻最多一个有效联系人；过期授权不提供权限。
- 候补/待确认/取消者不能签到、上车、节点打卡或到家；取消/拒绝/移除后不存在分配和有效位置。
- 去程上车不写返程；未签到不自动判失约；人工签到须有非空依据。
- 已记录 joined 的人不能被取消报名或改成 not_departed；下撤仍属出行者。
- archived 必须所有 confirmed 人员 departure 为 joined 或 not_departed，joined 全有 home，open incident=0；coordinating 不能归档。
- cancelled 无有效分配、开放招募或有效位置；archived/cancelled 拒绝业务编辑，仅允许本人已读与隐私撤回等不会伪改履约的操作。
- 医疗/紧急联系人不写事件摘要和通知正文模板；通用视图/车辆视图不包含敏感字段。

### 5.3 活动与现场状态机

| 操作 | 必需前置条件 | 同一事务的结果 |
|---|---|---|
| 发布 | owner；草稿；标题、起止/截止、路线风险、至少一集合点有效；deadline≤start<end，日期含时区 | phase=published；选择“我也参加”才创建 owner confirmed 报名/Consent/Attendance；不自动把 owner 算成出行者 |
| 开始集合 | owner；published；没有 pending（逐项处理），waitlisted 可继续只读保留 | phase=gathering；acceptingSignups=false |
| 活动出发 | owner；gathering；每位 confirmed 已有 joined/not_departed/coordinating；joined 须已签到，乘客须有去程上车事实 | phase=active；coordinating 自动创建未结 late 异常，不假标未出发 |
| 迟到到场 | owner/授权协作；active；本人之前 coordinating | 补核实签到/必要上车后变 joined；late 异常仍需单独解决 |
| 结束行程 | owner；active；必须写正常结束或提前终止原因 | phase=closing；关闭招募，所有未撤回位置停止授权展示；未到家和异常保留 |
| 归档 | owner；closing；无 coordinating/unknown、joined 全有到家、无未结异常 | phase=archived；业务只读 |
| 取消活动 | owner；draft/published/gathering；**没有已出发车辆或 joined 人员** | phase=cancelled；所有有效资格改 cancelled；清空分配、撤销位置、保留记录及通知；若已真实出发只能走 active→closing |

补充：车辆已出发而整场尚在 gathering 时不能用“取消活动”绕过收尾；如需终止，领队先确认出发事实再进入 active/closing。时间流逝不会触发自动结束或归档。

### 5.4 原子边界与失败语义

| 操作 | 同一次提交包含 | 失败时 | 提示/告警 |
|---|---|---|---|
| 多人报名 | 完整组、独立人员、占位、Attendance、receipt、事件 | 任一人员错则全部不写；容量不足提示整组候补，用户明确同意后新提交 | 字段/容量错误内联，不假 Toast |
| 审核/候补提升 | 所选状态与占位一起写；同行组升 pending 时完整选择 | 无部分确认；waitlist→pending 始终手动，不管 approvalMode | 工作台待办 |
| 取消/修改交通 | 目标资格或资料、释放旧 Assignment、撤回相关位置、事件、定向通知 | 其他同行人不变；已集合改点由领队明确协调，已上车拒绝直接修改 | 显示具体影响人数与旧安排 |
| 配车预览提交/换座 | revision、全部分配、容量/座位/点位/同行约束 | 任一冲突则整份不变；不偷偷删除旧安排来腾位 | 保留预览并标过期，提供重算 |
| 车辆改核载/司机/点位/删除 | 新车辆、受影响分配的合法性、授权关系 | 会使旧安排非法时拒绝；先显式取消分配，不静默挪人 | 指出受影响者 |
| 代签到/上车/到家 | 单人事实、操作人、时间、依据、事件 | 重试不重复；不自动修改其他履约维度 | 安全缺口持续可见 |
| 协作撤权 | membership 撤销，投影立即更新 | 不留旧明细在弹层或缓存 | 当前任务已调整 |
| 发布站内通知 | Notice、受众、事件 | 不产生半条通知 | 表单保留 |
| 外发/复制 | 真实浏览器复制成功或明确模拟渠道结果；单独追加 Delivery | 不回滚站内发布；保存 Delivery 失败也不能谎报已记录 | “已复制，记录未保存”等分开说明 |
| 本地快照写入 | 新业务状态、receipt、revision 一次 setItem | store 保持原引用、表单保留 | 持续错误条，可重试 |
| 缓存损坏/版本不识别 | 不覆盖原始字符串、不进行猜测迁移 | 只读错误页；明确确认才清空本原型的键并重置 | 非空态；无外部遥测 |
| 离线 | 已加载视图可读，显示快照时间 | 关键业务写入返回 OFFLINE，不排后台补交队列 | 联网后用户重试 |

“告警”指本地界面提示，不建设监控平台。只有意外开发错误可输出不含个人信息的错误码；不得 console.log 全量 state 或表单。

### 5.5 性能与范围成本

- 单活动索引在一次 selector/命令内建立 Map，随后复用；不在每行组件扫描全量 state。
- 分车只在点击“生成预览”时运行：按上车点/组分桶、保留已有安排，最坏约 O(n·m)；不做路径规划或全局最优求解。
- 本地每次保存完整快照 O(S)，校验 O(S + n·m)，S 为演示数据总量；**这不是生产规模方案**。原型只缓存几场活动，容量输入上限500为防误填护栏，不是性能承诺。
- 未改快照时 getSnapshot 返回同一引用；权限投影按快照引用、账号、请求和演示时间缓存，不在 getSnapshot 中每次构造新对象。
- 时效检查由运行时每分钟刷新及切换账号/恢复窗口时立即触发；位置边界使用 `>30分钟`；授权到期时 `now >= expiresAt` 即不可见。
- 原型渲染与分车耗时在 T16 记录实测，不能在计划里写“毫秒级已达标”。

## 6. 执行任务：每项先 RED，再 GREEN

以下命令均以 APP 为工作目录。工具调用使用 `dir_path`；不要在项目根目录运行 npm install。每项内按勾选步骤推进，失败先定位原因，不跳过测试、不用 `--passWithNoTests`。

### T01 · 建立独立工程与测试入口

**文件：** 创建 APP 下 `package.json`、`index.html`、`tsconfig.json`、`vite.config.ts`、`playwright.config.ts`、`.gitignore`、`tests/setup.ts`；启动入口 `src/main.tsx`、`src/App.tsx` 在 T12 接入业务。

- [ ] 1. 执行前确认 APP 尚不存在或检查其中已有内容；先列父目录，再创建 APP、src、tests。若用户已在另一环境写入实现，先核实，不覆盖。
- [ ] 2. 写入以下基础配置，然后仅在 APP 安装依赖。生成 package-lock.json，后续用 npm ci。

`package.json` 的基础内容：

```json
{
  "name": "ourtrail-v1-prototype",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173 --strictPort",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "npm run typecheck && vite build",
    "preview": "vite preview --host 127.0.0.1 --port 4173 --strictPort",
    "test:e2e": "playwright test"
  }
}
```

本轮于 2026-09-24 只读查询 npm registry：React 19.3.0、Vite 8.3.0、Vitest 5.0.1、TypeScript 7.0.2、plugin-react 6.1.1、jsdom 30.1.1、Zod 4.6.5 可查。当前 Router 最新是8.4.0，但本计划固定7.18.2，与已核实 v7 导入一致。Node24.18满足所查引擎要求；**尚未安装、未验证整套依赖组合**。

```bash
npm install --save-exact react@19.3.0 react-dom@19.3.0 react-router@7.18.2 zod@4.6.5
npm install --save-dev --save-exact typescript@7.0.2 vite@8.3.0 @vitejs/plugin-react@6.1.1 vitest@5.0.1 jsdom@30.1.1 @types/react@19 @types/react-dom@19 @types/node@24 @testing-library/react@16.3.3 @testing-library/dom@10 @testing-library/user-event@14 @testing-library/jest-dom@6 @playwright/test@1.63.0
```

`@types` 和 Testing Library 的主版本约束在安装时解析成精确版本并写锁文件。若 registry/peer 发生变化，核实错误与官方文档后更新本节实测值，不能用 `--force` 或 `--legacy-peer-deps` 掩盖不兼容。

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests", "vite.config.ts", "playwright.config.ts"]
}
```

`vite.config.ts`（一份配置，Vitest 不另覆盖 Vite 配置）：

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
```

`tests/setup.ts`：

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
```

`index.html`：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#163E35" />
  <link rel="icon" href="data:," />
  <title>OurTrail · 一次活动，一套协作</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

`.gitignore` 仅含 `node_modules/`、`dist/`、`test-results/`、`playwright-report/`；不要把源码/锁文件忽略，也不改根目录配置。

`playwright.config.ts`：

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
  },
});
```

当前本机有 Chrome，可先使用 `channel: 'chrome'`；不存在时再单独安装 Playwright Chromium，不能把浏览器缺失误报为产品失败。

- [ ] 3. 进入 T02 写首个模型测试并执行，预期因 model.ts 尚不存在而失败；不能为获得“全绿”删掉测试。
- [ ] 4. 本任务检查 `npm ls --depth=0` 无 invalid/missing peer；构建在 T12 有入口后首次执行，T01 不报告构建通过。

### T02 · 模型、合成场景与测试辅助函数

**文件：** 创建 `src/domain/model.ts`、`src/domain/contracts.ts`、`src/data/fixtures.ts`、`tests/model.test.ts`、`tests/helpers.ts`；跨记录约束在 T04 完成。

- [ ] 1. 先写以下 `tests/model.test.ts`。

```ts
import { describe, expect, it } from 'vitest';
import { StateSchema } from '../src/domain/model';
import { createFixture } from '../src/data/fixtures';

const now = '2026-09-24T07:00:00+08:00';
describe('合成快照', () => {
  it.each(['empty', 'signup', 'transport', 'gathering', 'active', 'closing', 'archived', 'cross-day'] as const)(
    '%s 的字段契约完整', name => {
      expect(StateSchema.safeParse(createFixture(name, now)).success).toBe(true);
    },
  );
  it('每次创建互不污染', () => {
    const first = createFixture('signup', now);
    first.activities[0].title = '只改第一份';
    expect(createFixture('signup', now).activities[0].title).not.toBe('只改第一份');
  });
  it('拒绝未知快照版本', () => {
    const state = createFixture('signup', now);
    expect(StateSchema.safeParse({ ...state, schemaVersion: 9 }).success).toBe(false);
  });
});
```

- [ ] 2. 运行 `npm test -- tests/model.test.ts`，记录 RED（模块不存在或 schema 不符合，不能是环境依赖损坏）。
- [ ] 3. 落实 §3/§4 的 schema、type 和样本。`createFixture('empty')` 含上述账号资料但没有活动；不默认创建虚假“我的报名”。fixture 构造是测试/演示入口，不提供任意状态编辑器给普通页面。
- [ ] 4. 创建测试辅助函数。`canonicalPayload` 实现在 contracts.ts，按 §4.2 排序；下面的辅助函数是实际测试 API，不另创造多个不同签名。

```ts
import { createHash } from 'node:crypto';
import type { State } from '../src/domain/model';
import type { Command, Payload, Result, Context, ParticipantInput } from '../src/domain/contracts';
import { canonicalPayload } from '../src/domain/contracts';
import { reduceCommand } from '../src/domain/commands';

export const NOW = '2026-09-24T07:00:00+08:00';
let sequence = 0;
export const context: Context = {
  now: NOW,
  id: kind => `${kind}-test-${++sequence}`,
};
export function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
export function makeCommand(
  state: State, payload: Payload, userId = 'u-owner',
  overrides: Partial<Command> = {},
): Command {
  return {
    actor: { userId }, requestId: `request-${++sequence}`,
    expectedRevision: state.revision,
    fingerprint: createHash('sha256').update(canonicalPayload(payload)).digest('hex'),
    payload, ...overrides,
  };
}
export function apply(state: State, payload: Payload, userId = 'u-owner'): State {
  return must(reduceCommand(state, makeCommand(state, payload, userId), context)).state;
}
export function inputFor(state: State, userId: string): ParticipantInput {
  const profile = state.profiles.find(item => item.id === userId);
  if (!profile) throw new Error(`Missing fixture ${userId}`);
  return {
    personRef: { kind: 'user', userId }, participant: structuredClone(profile.person),
    trip: { mode: 'shared', pickupPointId: 'p-xipu' },
    consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
  };
}
```

辅助文件引用 commands.ts 到 T04 才可执行；T02 的 model.test.ts 不导入它。canonicalPayload 的返回类型是 string，不在此文件直接导入浏览器 crypto。

- [ ] 5. 再跑 `npm test -- tests/model.test.ts`，预期全部通过。类型检查遇到后续未创建模块不得伪报全工程成功；T04 收齐核心接口后统一运行。

### T03 · 资源权限与白名单投影

**文件：** 创建 `src/domain/permissions.ts`、`src/domain/selectors.ts`、`tests/permissions.test.ts`。

- [ ] 1. 写以下测试，运行 `npm test -- tests/permissions.test.ts` 获取 RED。

```ts
import { expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { selectView, selectSensitive } from '../src/domain/selectors';

const now = '2026-09-26T07:15:00+08:00';
it('角色参数不能给陌生人管理权限', () => {
  const state = createFixture('transport', now);
  const view = selectView(state, { userId: 'u-other' }, {
    kind: 'activity', activityId: 'a1', perspective: 'organizer',
  }, now);
  expect(view).toMatchObject({ kind: 'denied', code: 'FORBIDDEN' });
});
it('车辆投影没有医疗、紧急联系人、位置和其他车乘客', () => {
  const state = createFixture('transport', now);
  const view = selectView(state, { userId: 'u-driver' }, {
    kind: 'activity', activityId: 'a1', perspective: 'vehicle', vehicleId: 'v1',
  }, now);
  expect(view.kind).toBe('activity');
  if (view.kind !== 'activity') throw new Error('Expected vehicle view');
  expect(view.positions).toEqual([]);
  expect(view.incidents).toEqual([]);
  expect(JSON.stringify(view)).not.toMatch(/"medical"|"emergency"/);
  const expected = state.assignments.filter(a => a.vehicleId === 'v1').map(a => a.signupId).sort();
  expect(view.vehicleTask?.passengers.map(p => p.signupId).sort()).toEqual(expected);
  expect(selectSensitive(state, { userId: 'u-driver' }, 'a1', 's-lin', '现场核实', now))
    .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});
it('到期时立即失去协作权限', () => {
  const state = createFixture('transport', now);
  const membership = state.memberships.find(m => m.userId === 'u-staff');
  if (!membership) throw new Error('Missing staff fixture');
  membership.expiresAt = now;
  expect(selectView(state, { userId: 'u-staff' }, {
    kind: 'activity', activityId: 'a1', perspective: 'staff',
  }, now)).toMatchObject({ kind: 'denied', code: 'FORBIDDEN' });
});
```

- [ ] 2. 按以下判定顺序实现权限，不能用全局 roles 数组。

```text
公开已发布详情：可读活动说明和公开名额；游客 rows=[]，不返回完整名单。
本人/代报：按 personRef.kind=user 的 userId 或 submittedByUserId 找到允许的 Signup。
组织者：只比较本场 ownerId，不因组织过其他活动获得权限。
协作：membership未过期 AND signup在scope AND capability匹配。
车辆：membership未过期 AND vehicleId匹配；只允许两程上车/车辆出发结束。
医疗：本人/已获权代报者，或本场owner/专项授权staff + 非空用途；历史归档/取消拒绝工作角色查看。
位置：本人可撤回；owner/staff还须位置授权有效且活动未closing/archived/cancelled。
导出：owner普通导出；敏感导出另选范围/用途；staff与车辆角色默认无导出能力。
```

命令鉴权中涉及多个 signupIds 时使用 **every**，任一不属于本场或范围则拒绝全部。先定位对象再做所属关系检查，不能只检查命令给出的 activityId。

- [ ] 3. 用对象字面量构造投影；禁止 `{ ...signup }` 再 delete 敏感字段。participant 只返回自己的名单；staff/vehicle 的履约计数从其可见范围派生，公开的总名额另列。
- [ ] 4. 加入“伪造 activityId + 他场 signupId”“staff 6人范围之外”“旧车辆任务”“游客点报名”的测试，逐项期望 FORBIDDEN/NOT_FOUND/AUTH_REQUIRED；敏感字段必须在序列化投影中不存在，而不只是 DOM 不展示。
- [ ] 5. 同命令跑到 GREEN，保留权限反例，不通过关闭权限检查让其他测试先跑。

### T04 · 原子命令入口、幂等与持久化

**文件：** 创建 `src/domain/commands.ts`、`src/domain/invariants.ts`、`src/data/store.ts`、`tests/store.test.ts`；contracts 中实现 canonicalPayload；领域处理器随 T05–T10 接入。

- [ ] 1. `tests/store.test.ts` 写存储失败与快照引用测试，先运行该测试 RED。

```ts
import { expect, it, vi } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { createStore } from '../src/data/store';
import { NOW, context, makeCommand } from './helpers';

it('保存失败时不发布任何内存成功状态', () => {
  const initial = createFixture('empty', NOW);
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const store = createStore(initial, storage, context);
  const notify = vi.fn();
  store.subscribe(notify);
  const before = store.getSnapshot();
  const result = store.dispatch(makeCommand(initial, {
    type: 'profile.save', person: { ...initial.profiles[0].person, name: '更新后的合成姓名' },
  }, initial.profiles[0].id));
  expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
  expect(store.getSnapshot()).toBe(before);
  expect(notify).not.toHaveBeenCalled();
});
it('未写入时 getSnapshot 返回同一引用', () => {
  const store = createStore(createFixture('empty', NOW), {
    getItem: () => null, setItem: () => undefined,
  }, context);
  expect(store.getSnapshot()).toBe(store.getSnapshot());
});
```

- [ ] 2. 按 §5.1 实现 reduceCommand，并先接通简单 `profile.save` 分支作为事务测试入口，其余未实现分支不能返回成功。switch 使用穷尽检查，最终 T10 不保留不支持的 Payload 分支。
- [ ] 3. 在 `store.ts` 实现以下提交骨架；只把预先通过 schema/invariants 的 initial 传入该函数。

```ts
import type { State } from '../domain/model';
import type { Command, Context, DispatchResult } from '../domain/contracts';
import { reduceCommand } from '../domain/commands';

export const STORAGE_KEY = 'ourtrail.prototype.v1';
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
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
        return { ok: false, error: {
          code: 'STORAGE_UNAVAILABLE', message: '这次修改没有保存，原安排未改变。',
        } };
      }
      current = state;
      listeners.forEach(listener => listener());
      return { ok: true, value: { targetIds, replayed } };
    },
  };
}
```

Context.now 由运行时在命令进入前更新；纯函数本身不更新时间。离线阻断、切换账号中断在 runtime.submitCommand，不能通过 UI 关按钮代替。

- [ ] 4. 同文件增加 `loadSnapshot(storage): Result<State | null>`：getItem 抛错返回 STORAGE_UNAVAILABLE；不存在返回 null；JSON/schema/invariants 失败返回 CORRUPT_SNAPSHOT，不 setItem。首次 seed 也须写成功后才能当作可写 store；不可写时显示明确只读演示状态，不假装刷新可保留。
- [ ] 5. 加入：同键同指纹 replay不增加revision/事件；同键异指纹 REQUEST_REUSED；旧revision CONFLICT；篡改外键 INVALID_INPUT；已保存JSON恢复为同一事实；损坏缓存不被覆盖；StrictMode订阅清理无重复通知。
- [ ] 6. 跑 `npm test -- tests/model.test.ts tests/permissions.test.ts tests/store.test.ts` 到 GREEN，并首次跑 `npm run typecheck`。不要用断言强转 State 绕过恢复检查。

### T05 · 创建、模板、发布与活动阶段

**文件：** 创建 `src/domain/activity.ts`、`tests/activity.test.ts`；修改 commands.ts 接入 `activity.*`。

- [ ] 1. 写下面测试，运行 `npm test -- tests/activity.test.ts` RED。

```ts
import { expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { reduceCommand } from '../src/domain/commands';
import { NOW, context, makeCommand, must } from './helpers';

it('复制模板只带活动内容，不带旧报名、车辆和授权', () => {
  const initial = createFixture('transport', NOW);
  const result = must(reduceCommand(initial, makeCommand(initial, {
    type: 'activity.copy', sourceActivityId: 'a1',
  }), context));
  const copiedId = result.targetIds[0];
  expect(result.state.activities.find(a => a.id === copiedId))
    .toMatchObject({ phase: 'draft', ownerId: 'u-owner', startAt: null, endAt: null, deadlineAt: null });
  expect(result.state.signups.filter(s => s.activityId === copiedId)).toHaveLength(0);
  expect(result.state.vehicles.filter(v => v.activityId === copiedId)).toHaveLength(0);
  expect(result.state.memberships.filter(m => m.activityId === copiedId)).toHaveLength(0);
});
it('进行中不能以取消清除履约', () => {
  const state = createFixture('active', NOW);
  const result = reduceCommand(state, makeCommand(state, {
    type: 'activity.transition', activityId: 'a1', next: 'cancelled', reason: '临时结束',
  }), context);
  expect(result).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
});
```

- [ ] 2. 实现创建草稿、编辑、复制、发布。复制重置日期/集合时刻，复制轻量路线内容与风险快照但不复制报名/敏感资料/司机授权；新建路线只在保存时作为拥有者的私有路线保存，不暴露路线市场。
- [ ] 3. `activity.publish` 按 §5.3 校验完整性；participation=null 不报名，非null只能是当前拥有者本人，有Consent且直接confirmed。任意人可以创建，不做认证申请或白名单。
- [ ] 4. 活动编辑按阶段限制：草稿可全部编辑；published可改但不能降低到低于占位、删除被报名引用的点/路线节点；gathering/active只允许说明及结束时间延长等不推翻已有事实的更正，必须通知变化；closing/archived/cancelled不允许普通编辑。
- [ ] 5. 加测试：截止晚于开始、结束早于开始、跨日、占位后降低capacity、取消清空Assignment但保留名单、已有车辆出发不允许取消；预期 INVALID_INPUT/CAPACITY/WRONG_PHASE 或合法phase不自动变更。
- [ ] 6. 运行目标测试及 `npm run typecheck` 到 GREEN；活动完整阶段的安全门在 T09 接齐后由 T15 统一验证。

### T06 · 报名、同行、审核、候补与局部取消

**文件：** 创建 `src/domain/signup.ts`、`tests/signup.test.ts`；修改 commands.ts。

- [ ] 1. 写真实断言并运行 `npm test -- tests/signup.test.ts` RED。

```ts
import { expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { reduceCommand } from '../src/domain/commands';
import { NOW, context, inputFor, makeCommand, must, apply } from './helpers';

it('待确认占位，重复请求不重复创建人', () => {
  const initial = createFixture('signup', NOW);
  const command = makeCommand(initial, {
    type: 'signup.submit', activityId: 'a1', participants: [inputFor(initial, 'u-new')],
    keepTogether: true, mode: 'apply',
  }, 'u-new');
  const first = must(reduceCommand(initial, command, context));
  const replay = must(reduceCommand(first.state, command, context));
  const added = first.state.signups.find(s => s.id === first.targetIds[0]);
  expect(added?.status).toBe('pending');
  expect(replay.replayed).toBe(true);
  expect(replay.state.revision).toBe(first.state.revision);
  expect(replay.state.signups).toHaveLength(initial.signups.length + 1);
});
it('取消苏晴不取消周遥，也不留下苏晴的车辆分配', () => {
  const initial = createFixture('transport', NOW);
  const next = apply(initial, {
    type: 'signup.cancel', activityId: 'a1', signupIds: ['s-su'], reason: '个人行程变更',
  }, 'u-zhou');
  expect(next.signups.find(s => s.id === 's-su')?.status).toBe('cancelled');
  expect(next.signups.find(s => s.id === 's-zhou')?.status).toBe('confirmed');
  expect(next.assignments.some(a => a.signupId === 's-su')).toBe(false);
});
```

- [ ] 2. 实现以下完整算法，处理一个候选快照，不逐个落盘。

```text
submit：检查published/开放/未截止/身份/逐人资料与同意。
  校验每个PersonRef可由提交者代表；同行人不冒用任意userId。
  检查组内重复与已有有效报名；按整组人数计算占位。
  apply不足：返回CAPACITY，未创建任何组/人员。
  waitlist：仅当该组当前放不下时接受，全部waitlisted，不占位。
  apply足够：manual全部pending，automatic全部confirmed。
  创建group、每人Signup+Attendance、事件、组织者待办通知。
review：仅owner，所有目标pending，confirm或reject原子执行。
promote：仅owner，目标全waitlisted；keepTogether组必须选择组内全部仍候补者。
  容量足够→全部pending；不自动分车；不自动轮候。
cancel：仅目标本人/提交者/owner；出发后改走incident，不能取消。
  participant取消→cancelled，owner移除他人→removed；释放分配和位置。
edit：只改所选报名快照，不反写个人常用资料；改点/改成自行到达清除旧分配并通知。
```

组内不同上车点可保留同行意愿，但自动分车须选能服务所有这些点的同一辆车；找不到即解释 group_too_large/pickup_mismatch，不静默拆组。明确“允许分开”只由提交者或领队记录，必须显示影响。

- [ ] 3. 补充具体测试：余1位报2人→CAPACITY且state未变；明确候补2人→两人waitlisted；automatic直接confirmed；已有本人重复→DUPLICATE_PERSON；无proxyAuthority→CONSENT_REQUIRED；只提升keepTogether半组→GROUP_SCOPE；取消其中一人不强制取消整组；同行人到家代确认另检查proxyHome。
- [ ] 4. 验证改点、改自行到达、取消与通知在同一revision；手工把UI状态设“已报名”不能替代这些断言。
- [ ] 5. 目标测试、权限回归与typecheck全部 GREEN 后进入交通实现。

### T07 · 车辆、自动预览、手调和原子换座

**文件：** 创建 `src/domain/allocation.ts`、`src/domain/transport.ts`、`tests/allocation.test.ts`、`tests/transport.test.ts`；修改 commands.ts。

- [ ] 1. 写测试，运行 `npm test -- tests/allocation.test.ts tests/transport.test.ts` RED。

```ts
import { expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { passengerCapacity, planAssignments } from '../src/domain/allocation';
import { reduceCommand } from '../src/domain/commands';
import { NOW, context, makeCommand, must } from './helpers';

it('核载扣除每位司机与不可用位', () => {
  const vehicle = createFixture('transport', NOW).vehicles.find(v => v.id === 'v2')!;
  expect(passengerCapacity(vehicle)).toBe(6);
  expect(passengerCapacity({ ...vehicle, blockedSeats: 1 })).toBe(5);
});
it('自动分配保留旧安排并且不修改输入', () => {
  const state = createFixture('transport', NOW);
  const before = structuredClone(state);
  const preview = must(planAssignments(state, { userId: 'u-owner' }, 'a1', NOW));
  expect(state).toEqual(before);
  for (const old of state.assignments) expect(preview.assignments).toContainEqual(old);
  expect(new Set(preview.assignments.map(a => a.signupId)).size).toBe(preview.assignments.length);
});
it('旧分车预览不能覆盖后来的安排', () => {
  const state = createFixture('transport', NOW);
  const preview = must(planAssignments(state, { userId: 'u-owner' }, 'a1', NOW));
  const changed = { ...state, revision: state.revision + 1 };
  const result = reduceCommand(changed, makeCommand(changed, {
    type: 'assignment.commit', activityId: 'a1', preview,
  }), context);
  expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  expect(changed.assignments).toEqual(state.assignments);
});
```

- [ ] 2. capacity 函数直接写如下，不做Math.max归零掩盖非法车辆。

```ts
export function passengerCapacity(vehicle: VehicleRecord): number {
  return vehicle.legalCapacity - vehicle.drivers.length - vehicle.blockedSeats;
}
```

- [ ] 3. 自动分配算法按以下顺序实施，输出完整本场预览，不直接提交。

```text
检查owner权限 → 取confirmed、shared、非参与者司机 → 深拷贝已有分配。
按已有分配计算每辆车剩余容量与空座号。
按报名顺序形成分配单元：keepTogether组为一个单元，允许拆分者每人一个。
已有部分分配的同行组：只能优先补到原车；原车放不下则保留旧安排，列出剩余未安排者。
没有已有分配的组：按车辆稳定顺序找一辆能覆盖全组上车点且容量足够的车。
每个单元完全可放才追加；编号车选最小可用座号，不保证物理相邻，因为未定义车型布局。
放不下→为每人写具体原因；不消失、不超载、不把已分配者移动到另一车。
返回baseRevision、全部新旧Assignment、unassigned。
```

- [ ] 4. commit再次验证：preview.activityId、baseRevision、所属引用、完整旧安排、同行/容量/座号规则。预览里的 unassigned 仅为说明，提交时重新推导；不能信任 UI 构造的“合法”预览。
- [ ] 5. 手动换座先在候选中取出两条旧分配，再同时放入新位置，最后统一校验；只写一个位置必须失败的测试证明不能拆成两次提交。换车后点位不匹配→PICKUP_MISMATCH；参与者司机被分乘客位→DRIVER_CONFLICT。
- [ ] 6. 增补真实边界：7座车6乘客满载；两名司机只余5；座号重复→SEAT_TAKEN；删除有安排车辆拒绝；降低核载导致超载拒绝；跨车原子交换失败不改任一人；自行到达不进unassigned；whole-group放不下保留明确未分配；车辆联系人不能调用配置/换座命令。
- [ ] 7. GREEN 后跑 signup+permissions 回归；UI未接通前不宣称分车功能已可用。

### T08 · 通知、已读、外发结果与导出

**文件：** 创建 `src/domain/notices.ts`、`tests/notices.test.ts`；扩充 selectors.ts；修改 commands.ts。

- [ ] 1. 写下面用例并运行 `npm test -- tests/notices.test.ts` RED。

```ts
import { expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { selectView, selectExport } from '../src/domain/selectors';
import { NOW, context, makeCommand, must, apply } from './helpers';
import { reduceCommand } from '../src/domain/commands';

it('同一通知在全局与活动内共享已读事实', () => {
  const state = createFixture('transport', NOW);
  const created = must(reduceCommand(state, makeCommand(state, {
    type: 'notice.publish', activityId: 'a1', audience: { kind: 'activity' }, content: '请于07:20在犀浦集合。',
  }), context));
  const noticeId = created.targetIds[0];
  const next = apply(created.state, { type: 'notice.read', activityId: 'a1', noticeId }, 'u-lin');
  for (const request of [{ kind: 'notices' as const }, { kind: 'notices' as const, activityId: 'a1' }]) {
    const view = selectView(next, { userId: 'u-lin' }, request, NOW);
    if (view.kind !== 'notices') throw new Error('Expected notices');
    expect(view.notices.find(n => n.id === noticeId)?.read).toBe(true);
  }
});
it('司机不能通过导出取得更多字段', () => {
  const state = createFixture('transport', NOW);
  expect(selectExport(state, { userId: 'u-driver' }, 'a1', ['s-lin'], 'sensitive', '核对资料', NOW))
    .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});
```

- [ ] 2. 站内通知只存一份。activity受众指本场相关人员，不是全平台用户；owner可见本场发布记录；signups受众仅目标本人/授权提交者和owner；vehicle受众按本车关系校验。自动状态通知写给受影响人员，不能把报名表或所有名单广播给全场。
- [ ] 3. 发布成功后外发按钮独立操作：`navigator.clipboard.writeText` 成功才记录 copied；拒绝时展示可手工选择的文本，不写“已复制”。订阅按钮明确“模拟订阅结果”，模拟成功文案不能写成微信已送达。readBy 只能由当前接收账号记录。
- [ ] 4. 普通 CSV 列固定为姓名、报名状态、上车点、车辆、座位、签到、去程上车、返程上车、到家；电话按当前用途另外选择，不默认进入导出。敏感 CSV 必须明确选择人员与填写用途，范围和字段二次确认；审计成功后再生成 Blob。
- [ ] 5. CSV 每格双引号包裹、内部引号翻倍；以 `= + - @` 或制表/回车开头的用户文本加单引号前缀，防表格公式执行。用 Blob 下载并 revokeObjectURL，不把内容上传第三方。
- [ ] 6. 补充：外发失败仍保留Notice；不同账号已读隔离；非受众noticeId拒绝；撤权后通知深链不泄露原明细；敏感导出空用途拒绝；姓名含引号/换行/公式时CSV转义正确。运行目标测试与权限回归到 GREEN。

### T09 · 签到、两程上车、节点、异常、位置与安全归档

**文件：** 创建 `src/domain/field.ts`、`tests/field.test.ts`；完善 activity.transition、invariants、selectors；接入 commands.ts。

- [ ] 1. 写以下测试并运行 `npm test -- tests/field.test.ts` RED。

```ts
import { expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { reduceCommand } from '../src/domain/commands';
import { selectView } from '../src/domain/selectors';
import { NOW, context, makeCommand, apply } from './helpers';

it('到家不自动解决下撤异常，仍禁止归档', () => {
  let state = createFixture('closing', NOW);
  state = apply(state, { type: 'attendance.home', activityId: 'a1', signupId: 's-su', note: '电话核实已到家' });
  state = apply(state, { type: 'attendance.home', activityId: 'a1', signupId: 's-lin', note: '本人确认' }, 'u-lin');
  const result = reduceCommand(state, makeCommand(state, {
    type: 'activity.transition', activityId: 'a1', next: 'archived', reason: '完成收尾',
  }), context);
  expect(result).toMatchObject({ ok: false, error: { code: 'UNRESOLVED_SAFETY' } });
  expect(state.incidents.some(i => i.resolution === null)).toBe(true);
});
it('进入收尾后不能新增位置，领队也不再看到旧坐标', () => {
  const state = createFixture('closing', NOW);
  const result = reduceCommand(state, makeCommand(state, {
    type: 'position.report', activityId: 'a1', signupId: 's-lin',
    coordinates: { lat: 30.9, lng: 103.5 }, consent: true,
  }, 'u-lin'), context);
  expect(result).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
  const view = selectView(state, { userId: 'u-owner' }, {
    kind: 'activity', activityId: 'a1', perspective: 'organizer',
  }, NOW);
  if (view.kind !== 'activity') throw new Error('Expected activity');
  expect(view.positions).toEqual([]);
});
```

- [ ] 2. 按阶段实现事实命令：gathering签到/去程上车；active允许coordinating迟到补到、节点/异常/位置；active或closing可返程清点；closing可到家与解决异常。未开始行程不能点“到家”，未知出发情况不能批量当安全。
- [ ] 3. 人工签到、领队代确认到家、未出发/迟到协调必须非空依据；self模拟定位仅来自明确按钮与模拟点。拒绝定位显示请现场核实，不写签到。手动上报位置仅本人操作，每次独立同意；consentExpiresAt使用本场当前endAt，若已过时须领队明确延长活动时间后重新授权，不自动无限续期。
- [ ] 4. 出发判定按 §5.3。车辆 departures 检查本车乘客逐人上车或有领队确认的未出发/迟到协调结果；车辆联系人不能替领队把未上车者改成未出发。`vehicle.complete` 只完成该车该程，不写任何人的home。
- [ ] 5. `incident.report` 原子写异常与事件。withdrawal不改变SignupStatus、不丢取消前的履约；resolve必须写核实结果，只改变本条incident；到家不会隐式resolve。
- [ ] 6. 增补：去程已上车返程仍未上车；姓名相同不串人；coordinating阻归档；not_departed不需要home但需依据；joined不能改成not_departed；本人重试到家不重复事件；司机不能标全员到家；30分钟整不灰、30分1秒灰；撤回位置立即不投影；代理提交者未经proxyHome授权不能代到家；活动跨日不自动关闭。
- [ ] 7. 运行 field、activity、permissions、store 全部 GREEN。归档门必须在domain，无权页面隐藏按钮只是体验。

### T10 · 个人资料、同行人、授权与敏感面板

**文件：** 完成 `src/domain/profile.ts`、`tests/privacy.test.ts`；完善 permissions/selectors/commands。

- [ ] 1. 写下面测试并运行 `npm test -- tests/privacy.test.ts` RED。

```ts
import { expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { selectSensitive, selectView } from '../src/domain/selectors';
import { NOW, apply } from './helpers';

it('更新常用资料不偷偷改历史报名快照', () => {
  const initial = createFixture('transport', NOW);
  const profile = initial.profiles.find(p => p.id === 'u-lin')!;
  const oldSignup = structuredClone(initial.signups.find(s => s.id === 's-lin'));
  const next = apply(initial, {
    type: 'profile.save', person: { ...profile.person, phone: '00000000099' },
  }, 'u-lin');
  expect(next.signups.find(s => s.id === 's-lin')).toEqual(oldSignup);
});
it('历史工作权限不能读取敏感资料', () => {
  const state = createFixture('archived', NOW);
  expect(selectSensitive(state, { userId: 'u-owner' }, 'a1', 's-lin', '历史查看', NOW))
    .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});
it('撤权立即使协作投影不可见', () => {
  const state = createFixture('transport', NOW);
  const membership = state.memberships.find(m => m.userId === 'u-staff')!;
  const next = apply(state, { type: 'membership.revoke', activityId: 'a1', membershipId: membership.id });
  expect(selectView(next, { userId: 'u-staff' }, {
    kind: 'activity', activityId: 'a1', perspective: 'staff',
  }, NOW)).toMatchObject({ kind: 'denied', code: 'FORBIDDEN' });
});
```

- [ ] 2. 完成profile/companion保存删除，仅作用于当前账号；删除常用同行人不删除已提交的报名与安全事实，其PersonRef保持历史可解释。不允许通过改常用资料篡改历史报名。
- [ ] 3. membership.save仅owner；staff有显式scope、capabilities和expiresAt；vehicle_contact只关联本车；车辆更换联系人同时失效旧关系，不能留两个有效联系人。
- [ ] 4. 敏感面板打开时校验用途/时间/关系，每次快照、账号或授权时间变化重新取投影。弹层只保存选中signupId与purpose，不长久缓存SensitiveView；切账号、关面板、撤权立即清除明文。
- [ ] 5. 补充类型反例：vehicle_contact无法携带staff capabilities；权限测试验证额外字段不能转化为授权。代理敏感资料与到家确认分别看dataUse/proxyAuthority/proxyHome，不能把一个勾选扩大成所有授权。
- [ ] 6. 跑全量 `npm test` 和 `npm run typecheck`；到这里每个Payload类型都有真正处理器，不能剩默认成功、空处理或“暂不支持”的业务分支。

### T11 · 视觉系统与基础组件

**文件：** 创建 `src/styles/tokens.css`、`src/styles/base.css`、`src/styles/components.css`，以及 §2.1 列出的7个 components；创建 `tests/ui.test.tsx`。

- [ ] 1. 先写StatusPanel恢复按钮测试，再写组件；运行 `npm test -- tests/ui.test.tsx` RED。StatusPanel的props固定为`{ kind: 'empty' | 'loading' | 'error' | 'denied' | 'offline'; title: string; detail: string; action?: { label: string; onClick: () => void } }`；error使用role=alert，非错误状态不抢读屏焦点。

```tsx
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusPanel } from '../src/components/StatusPanel';

it('错误清楚说明未保存并提供真实重试动作', async () => {
  const retry = vi.fn();
  render(<StatusPanel kind="error" title="这次修改没有保存"
    detail="原安排未改变，你填写的信息仍在。"
    action={{ label: '重新提交', onClick: retry }} />);
  expect(screen.getByRole('alert')).toHaveTextContent('原安排未改变');
  await userEvent.click(screen.getByRole('button', { name: '重新提交' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
```

Overlay对外契约固定如下；其原生焦点行为通过T16实浏览器验证。

```tsx
import type { ReactNode } from 'react';

export type OverlayProps = {
  kind: 'sheet' | 'dialog';
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};
```

使用同一个原生 `<dialog>` 基础承载sheet/dialog，不添加第三方UI库。open改变时在effect调用showModal/close；cancel事件阻止默认后调用onClose，清理时关闭；有可见关闭按钮与aria-labelledby；记录触发元素并在关闭后恢复焦点。浏览器Back先关闭顶层Overlay，不离开活动；禁止叠两层Sheet。原生dialog的真实焦点锁定在T16浏览器验证，jsdom不能证明此行为。

- [ ] 2. 写入tokens，替代任意颜色和间距；关键起点如下，组件只引用语义token。

```css
:root {
  --forest: #163e35;
  --leaf: #d6ea8a;
  --stone: #f5f5f0;
  --white: #fff;
  --ink: #202a26;
  --muted: #5f6e66;
  --line: #dee3db;
  --danger: #b43d3b;
  --warning: #8c5a12;
  --success: #276145;
  --info: #346583;
  --color-bg: var(--stone);
  --color-surface: var(--white);
  --color-text: var(--ink);
  --color-primary: var(--forest);
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --radius-tag: 5px;
  --radius-button: 8px;
  --radius-card: 14px;
  --radius-sheet: 20px;
  --font-body: 14px;
  --line-body: 22px;
  --font-caption: 12px;
  --line-caption: 18px;
  --button-height: 48px;
  --tap-size: 44px;
  --motion-duration: 180ms;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--color-text);
  background: var(--color-bg);
  font: var(--font-body)/var(--line-body) system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
button, input, select, textarea { font: inherit; }
button { min-height: var(--tap-size); }
:focus-visible { outline: 2px solid var(--forest); outline-offset: 3px; }
.app-frame { width: 100%; max-width: 430px; min-height: 100dvh; margin-inline: auto; }
.page { padding: var(--space-5); padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
.page > * { min-width: 0; }
.sticky-action { padding-bottom: max(var(--space-3), env(safe-area-inset-bottom)); }
@media (prefers-reduced-motion: reduce) {
  :root { --motion-duration: 0ms; }
}
```

输入框移动端可用16px避免浏览器聚焦缩放；不把整页正文都降成样张内的10/12px。桌面只增加评审外框和演示工具，主任务仍为手机宽度，不变桌面后台。

- [ ] 3. ActivityCard只一个主链接，PersonRow有状态文本且图标有名称；FormField固定label/error关联；StatusPanel区分empty/loading/error/denied/offline，不用一个空图糊所有错误。
- [ ] 4. Icon使用本地SVG、24画布、1.75描边；头像使用姓/名首字，保留两条同行轨迹品牌图案，不凭空添加注册标识、认证、评分或实景照片。
- [ ] 5. 组件测试 GREEN 后保存；视觉结论留到接入运行页面再验证，不能仅依据CSS声称还原完成。

### T12 · 运行时、路由、返回和授权订阅

**文件：** 创建 `src/app/runtime.ts`、`src/app/useView.ts`、`src/app/navigation.tsx`、`tests/navigation.test.tsx`。`src/App.tsx`、`src/main.tsx` 的实际页面装配放在T13，完整三入口在T14接齐。

- [ ] 1. navigation测试先覆盖非法路由回首页、详情直达返回首页、站内返回恢复搜索参数、账号变化关闭敏感面板。使用仅位于测试文件的MemoryRouter测试宿主验证导航策略，不提前导入尚未创建的业务screen；HashRouter真实前进后退留T16。运行 `npm test -- tests/navigation.test.tsx` RED。
- [ ] 2. runtime只在应用启动装配一次。公开接口为 `read(request)`、`subscribe(listener)`、`submitCommand(payload, requestId, expectedRevision)`、`setDemoUser(userId)`、`setPerspective(perspective)`、`setDemoTime(now)`、`resetDemo(name)`；不向screen导出原始store。
- [ ] 3. `useView` 在外部源订阅稳定快照后用memo派生视图；不能在getSnapshot里返回新对象。骨架如下；runtime实现 `subscribe/getVersion/read` 三个稳定函数，getVersion在业务、账号、时间或视角变化时递增。

```ts
import { useMemo, useSyncExternalStore } from 'react';
import type { ReadRequest } from '../domain/contracts';
import { runtime } from './runtime';

export function useView(request: ReadRequest) {
  const version = useSyncExternalStore(runtime.subscribe, runtime.getVersion);
  return useMemo(() => runtime.read(request), [version, request]);
}
```

调用方按activityId/perspective等原始参数用useMemo构造稳定request；不得将外部URL参数未经白名单解析当成ReadRequest。getVersion返回稳定的数字而不是临时对象，避免外部store渲染循环。页面请求包含perspective仅作为投影请求，不改actor或membership。

- [ ] 4. 采用 `react-router` v7 的 HashRouter、Routes、Route、Outlet、Navigate、useNavigate、useSearchParams；禁止混入v8包或在同工程维护第二套路由器。路由契约见 §7。
- [ ] 5. `navigation.tsx` 只保存站内导航记录与页面滚动，不看 `history.length` 猜站内历史。站内跳转写入已知记录，刷新/外部分享直达无记录则back替换至`/`。查询参数只接受允许的filter/tab/preview；returnTo只接受应用内白名单路径，不接受外部协议或`//host`。
- [ ] 6. 表单草稿存在runtime的账号+activityId+form键下，只保存合成输入；切账号不复用他人草稿。业务提交成功才清草稿。刷新持久化活动事实；未保存的表单刷新前提示，不宣称表单跨刷新自动恢复。
- [ ] 7. 演示工具与产品“我的”分开：切换的是“演示账号”，并明确不是产品角色切换；普通视角切换不授予权限。reset需二次确认，只重置`ourtrail.prototype.v1`及本工程的导航键，不调用localStorage.clear。
- [ ] 8. 运行组件/导航测试和typecheck；T12只验收运行时与导航策略，不以假业务页面凑首次build。T13装配真实页面后首次build并启动dev验证已有路径；T14接齐通知、我的和任务页后再验证完整三入口，不能提前声称全部导航可用。

### T13 · 参与者与组织者页面接线

**文件：** 创建 `src/App.tsx`、`src/main.tsx`，以及 `src/screens/` 下的 ActivityHome.tsx、ActivityDetail.tsx、Signup.tsx、ActivityEditor.tsx、Workspace.tsx、Roster.tsx、Transport.tsx；扩展 ui/navigation测试。App只装配已实现页面，首次build与dev验证从本任务开始；T14在同一App补齐其余路由。

- [ ] 1. 写三个组件集成测试：报名必填未过不dispatch；保存失败仍保留输入；确认成功后通过共享store刷新个人详情和组织者人数。运行目标测试 RED。
- [ ] 2. ActivityHome合并近期/历史/最近打开，搜索只在可见集合内；默认参与者。最近打开记录只影响首页列表，不授予管理权限。没有报名/记录则真实空态，不展示陌生推荐。
- [ ] 3. ActivityDetail通过getDetailState派生CTA；个人本人和同行人分别展示资格与安排。主CTA规则：new报名、pending等待确认、confirmed查看待安排、ready查看集合、gathering签到、checked查看上车、active节点/异常、closing到家、finished只读、waitlist候补说明、closed截止、cancelled取消说明。费用只作文字面板。
- [ ] 4. Signup逐位人员编辑，紧急联系人、同意用途、代理权限独立校验；选择上车点/自行到达使用Trip联合类型；失败定位首错且保持其余输入；容量失败显示“整组候补/调整人数”，不能静默改状态。
- [ ] 5. ActivityEditor三步：活动与时间→集合与路线→招募/风险。可存草稿、从自己已有活动复制模板、共享详情预览；预览不写published，不创建分享。发布后显示真实创建ID和链接。
- [ ] 6. Workspace只作为本场容器：总览/人员/交通/现场；通知为公共工具入口。Roster支持搜索、状态筛选、逐人/明确批选审核、代报、分管授权、导出。Transport车辆表单、预览、手调、编号座位、原子交换；空车辆时指向登记车辆，不生成虚构车牌。
- [ ] 7. 每个页面按 §7 的按钮表接线；“成功”来源仅DispatchResult.ok。确认框关闭不触发命令，提交处理中禁重复点击且仍保留可取消的表单视图。
- [ ] 8. 浏览器先走创建→发布→报名→审核→分配→切账号确认座位的实际黄金路径；同时检查人数口径、页面返回、320px表单。记录问题并修复，不等最终测试才第一次点击。

### T14 · 现场、两种任务页、天气、通知和我的

**文件：** 创建 Field.tsx、StaffTask.tsx、VehicleTask.tsx、Weather.tsx、Notices.tsx、Profile.tsx；扩充组件测试。

- [ ] 1. 先写受限任务页测试：driver页面没有“医疗/紧急联系人/分车”；staff只渲染分管名单；closing持续显示待到家和未结异常；运行RED。
- [ ] 2. Field复用PersonRow，包含名单/节点/异常/队员位置。地图用标“示意、非导航”的本地SVG及坐标列表；地点无坐标时不画假点。显示上报时间与撤回入口，不做自动移动、连续采样或后台追踪。
- [ ] 3. closing复用Field，显著显示待核实人员与未结异常；到家只能逐人确认或有逐人依据的代确认，不做“一键全员安全”。归档失败展示具体阻塞人/异常，不只是disabled无解释。
- [ ] 4. StaffTask显示授权范围及有效期，动作限定checkin/node/incident/home各自capability；敏感专项需单独面板。VehicleTask按去程/返程切换，集合点分组、应到/已上车、必要联系、车辆出发/结束；司机无完整工作台菜单。
- [ ] 5. Weather按活动关键点/日期选择固定模拟数据；out_of_range不显示天气数字，unavailable保留地点日期和重试。天气提示生成组织者通知草稿，不直接发布或声称适宜出发。
- [ ] 6. Notices显示站内发布、已读、复制、模拟订阅各自状态，点击回当前有权限的任务。Profile可修改本人/常用同行人资料、查看用途、撤回位置和进入已有工作视角；无公众领队主页/俱乐部频道。
- [ ] 7. 同一store下实际切四个账号，验证报名/车辆/上车/通知/到家联动；撤权后当前页面和打开的面板都不残留字段。完成领域、组件与typecheck回归。

### T15 · 完整生命周期与不变量回归

**文件：** 创建 `tests/lifecycle.test.ts`，补齐前述测试文件中的边界表。

- [ ] 1. 写完整链路，不通过直接把phase改成下一阶段来绕过命令。以下用现成活动样本仅取配置，业务状态从empty创建。

```ts
import { expect, it } from 'vitest';
import type { ActivityInput } from '../src/domain/contracts';
import { createFixture } from '../src/data/fixtures';
import { reduceCommand } from '../src/domain/commands';
import { assertInvariants } from '../src/domain/invariants';
import { NOW, context, inputFor, makeCommand, must, apply } from './helpers';

it('从新活动到安全归档使用同一套事实', () => {
  let state = createFixture('empty', NOW);
  const source = createFixture('signup', NOW).activities.find(a => a.id === 'a1')!;
  const { id, ownerId, phase, ...template } = source;
  const input: ActivityInput = { ...template, routeId: null, capacity: 4, approvalMode: 'manual' };
  const created = must(reduceCommand(state, makeCommand(state, { type: 'activity.create', input }), context));
  state = created.state;
  const activityId = created.targetIds[0];
  state = apply(state, { type: 'activity.publish', activityId, participation: null });
  const participant = inputFor(state, 'u-new');
  const submitted = must(reduceCommand(state, makeCommand(state, {
    type: 'signup.submit', activityId, participants: [participant], keepTogether: true, mode: 'apply',
  }, 'u-new'), context));
  state = submitted.state;
  const signupId = submitted.targetIds[0];
  state = apply(state, { type: 'signup.review', activityId, signupIds: [signupId], decision: 'confirm' });
  const savedVehicle = must(reduceCommand(state, makeCommand(state, {
    type: 'vehicle.save', activityId, vehicleId: null,
    input: {
      label: '测试1号车', plate: '演示车01', legalCapacity: 7,
      drivers: [{ kind: 'service', name: '许川', phone: '00000000003', userId: 'u-driver' }],
      blockedSeats: 0, seatLabels: null, pickupPointIds: ['p-xipu'],
    },
  }), context));
  state = savedVehicle.state;
  const vehicleId = savedVehicle.targetIds[0];
  state = apply(state, {
    type: 'membership.save', activityId,
    membership: { id: 'm-driver-lifecycle', activityId, userId: 'u-driver', role: 'vehicle_contact', vehicleId, expiresAt: source.endAt! },
  });
  state = apply(state, { type: 'assignment.set', activityId, target: { signupId, vehicleId, seatLabel: null } });
  state = apply(state, { type: 'notice.publish', activityId, audience: { kind: 'activity' }, content: '集合与车辆已安排。' });
  state = apply(state, { type: 'activity.transition', activityId, next: 'gathering', reason: '开始集合' });
  state = apply(state, {
    type: 'attendance.checkin', activityId, signupId,
    checkIn: { method: 'manual', evidence: { at: NOW, by: 'u-owner', note: '现场见到本人' } },
  });
  state = apply(state, { type: 'attendance.board', activityId, signupId, leg: 'outbound', boarded: true, note: '已在车上' }, 'u-driver');
  state = apply(state, {
    type: 'attendance.departure', activityId, signupId,
    outcome: { kind: 'joined', evidence: { at: NOW, by: 'u-owner', note: '核实随队出发' } },
  });
  state = apply(state, { type: 'vehicle.depart', activityId, vehicleId, leg: 'outbound', note: '人数核对完成' }, 'u-driver');
  state = apply(state, { type: 'activity.transition', activityId, next: 'active', reason: '开始行程' });
  const incident = must(reduceCommand(state, makeCommand(state, {
    type: 'incident.report', activityId, signupIds: [signupId], kind: 'withdrawal', description: '合成示例：中途下撤，领队跟进。',
  }), context));
  state = apply(incident.state, { type: 'attendance.returnPlan', activityId, signupId, plan: 'independent', note: '领队核实由接应人员送回' });
  state = apply(state, { type: 'activity.transition', activityId, next: 'closing', reason: '行程结束，继续安全确认' });
  state = apply(state, { type: 'attendance.home', activityId, signupId, note: '本人已到家' }, 'u-new');
  const blocked = reduceCommand(state, makeCommand(state, {
    type: 'activity.transition', activityId, next: 'archived', reason: '尝试归档',
  }), context);
  expect(blocked).toMatchObject({ ok: false, error: { code: 'UNRESOLVED_SAFETY' } });
  state = apply(state, { type: 'incident.resolve', activityId, incidentId: incident.targetIds[0], note: '下撤接应和安全结果已核实' });
  state = apply(state, { type: 'activity.transition', activityId, next: 'archived', reason: '安全缺口全部关闭' });
  expect(state.activities.find(a => a.id === activityId)?.phase).toBe('archived');
  expect(state.signups.find(s => s.id === signupId)?.status).toBe('confirmed');
  expect(state.attendance.find(a => a.signupId === signupId)?.boardingByLeg.return).toBeNull();
  expect(assertInvariants(state)).toEqual({ ok: true, value: null });
});
```

去程上车不要求必须乘同车返程；下撤者仍可在安全核实后归档。返程名单对原安排中不乘返程的人需领队明确记录安排，详见 §8 的模型补充约束，不能由司机随意忽略。

- [ ] 2. 运行 `npm test -- tests/lifecycle.test.ts`，先记录真实失败点，再修根因至GREEN。若通过但实际没覆盖未结异常阻归档，先加强断言而不是宣称闭环。
- [ ] 3. 对 §5.2 每条不变量至少构造一个非法候选：错误返回且原state深相等；合法样本全部通过；反例不通过直接改fixture来迎合结果。
- [ ] 4. 运行 `npm test`、`npm run typecheck`、`npm run build`；记录实际测试条数、失败数、构建结果。此时仍需T16浏览器验收，不能仅凭这些报告用户功能完成。

### T16 · 浏览器、视觉、响应式与交付证据

**文件：** 创建 `tests/e2e/prototype.spec.ts`；截图/trace写 `test-results/`。不修改已批准HTML作为“对齐”捷径。

- [ ] 1. 从T13/T14已经运行的界面编写用户可见定位器；例如下列回归不允许直接注入报名状态。

```ts
import { test, expect } from '@playwright/test';

test('报名结果跨账号可见且刷新保留', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '演示工具', exact: true }).click();
  await page.getByLabel('演示场景').selectOption('signup');
  await page.getByRole('button', { name: '重置演示数据', exact: true }).click();
  await page.getByRole('button', { name: '确认重置', exact: true }).click();
  await page.getByLabel('演示账号').selectOption('u-new');
  await page.getByRole('button', { name: '关闭演示工具', exact: true }).click();
  await page.goto('/#/activities/a1');
  await page.getByRole('button', { name: '报名这场活动', exact: true }).click();
  await page.getByLabel('使用本人常用资料').check();
  await page.getByLabel('上车点', { exact: true }).selectOption('p-xipu');
  await page.getByLabel('同意本场活动使用所填资料').check();
  await page.getByRole('button', { name: '确认报名信息', exact: true }).click();
  await expect(page.getByText('待确认 · 已占名额', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('待确认 · 已占名额', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '演示工具', exact: true }).click();
  await page.getByLabel('演示账号').selectOption('u-owner');
  await page.getByRole('button', { name: '关闭演示工具', exact: true }).click();
  await page.goto('/#/activities/a1/workspace?tab=roster');
  const row = page.getByRole('listitem').filter({ hasText: '顾言' });
  await expect(row).toContainText('待确认');
  await row.getByRole('button', { name: '确认', exact: true }).click();
  await expect(row).toContainText('已确认');
});

test('移动端与桌面均无根页面横向溢出', async ({ page }) => {
  for (const width of [320, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/activities/a1');
    await expect(page.getByRole('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
```

`使用本人常用资料`可填资料但**不能自动勾选同意**。演示账号/演示时间允许在本工程的sessionStorage保存以便refresh后保持身份，reset只清本原型对应键。E2E每个测试独立浏览器上下文，截图场景各自明确seed与账号。

- [ ] 2. 执行 `npm run test:e2e`；若先前有自己启动的5173服务，先识别并正常停止该服务或使用另一明确端口。不要杀不明进程，也不要把reuseExistingServer改true接上不明页面。
- [ ] 3. 通过浏览器实际走完整黄金路径与 §8 边界：创建→预览→发布→分享直达→本人/同行报名→审核→分车分座→通知→签到/上车→出发→节点/异常→结束→到家→解决异常→归档。司机去程/返程分开验证，协作越权与撤权在已打开页面验证。
- [ ] 4. 检查12种详情状态、空态、错误、离线、存储不可写、缓存损坏、超长姓名/标题、0车/满车、无定位、天气范围外。不存在的活动显示NOT_FOUND，不回填另一场活动。
- [ ] 5. 320/390/430px检查全14布局；768/1440检查外框；至少保存首页、报名错误、工作台、座位、司机、收尾、权限错误截图。逐张查看图片，不只检查文件生成；桌面与手机分别核对批准稿 §05/§06。
- [ ] 6. 键盘顺序、焦点可见、Dialog锁焦/恢复、Esc、浏览器Back先关面板、系统返回、200%缩放、减少动效、44px触控、14/12px正文说明、底部安全区逐项验证。颜色对比测量后才能声称通过；不把基本检查包装成WCAG完整认证。
- [ ] 7. 收集pageerror、console.error与失败网络请求，所有预期模拟错误有明确标签，不掩盖意外错误。记录首次渲染/分车预览的测量环境和数据规模，不以单次结果推断生产容量。
- [ ] 8. 最后再跑 `npm test && npm run typecheck && npm run build && npm run test:e2e`。报告真实结果、浏览器截图路径、已知限制与启动方法；只有全部门槛满足才将“实现并验证原型”任务标完成。

## 7. 页面、路由与真实动作清单

### 7.1 路由和14个布局落点

浏览器地址形如 `http://127.0.0.1:5173/#/activities/a1`，只由当前location.origin/pathname生成分享，不硬编码生产域名。

| 布局基线 | Hash 内路由 | 页面/子屏 | 主要动作与返回 |
|---|---|---|---|
| 01 home | `/`，query=`filter,search` | ActivityHome | 我的/最近打开/历史；列表滚动恢复；发起入口弱化 |
| 02 detail | `/activities/:activityId` | ActivityDetail | 报名/签到/节点/到家随状态变化；无站内前项回首页 |
| 03 signup | `/activities/:activityId/signup` | Signup | 提交、明确候补、同行人编辑；成功回详情 |
| 04 weather | `/activities/:activityId/weather` | Weather | 关键点与日期；返回本场活动；通知草稿只对owner显示 |
| 05 notices | `/notices` 或 `/activities/:activityId/notices` | Notices | 同一通知源；读取/复制/模拟外发/受限任务深链 |
| 06 profile | `/me` | Profile | 常用信息、同行人、隐私说明、已有工作任务 |
| 07 organizer | `/activities/:activityId/workspace?tab=overview` | Workspace | 真实待办计数，跳转对应任务区 |
| 08 create | `/activities/new` 或 `/activities/:activityId/edit` | ActivityEditor | 三步、保存、模板、预览、发布 |
| 09 roster | `/activities/:activityId/workspace?tab=roster` | Roster | 审核/候补/取消/代报/授权/导出 |
| 10 transport | `/activities/:activityId/workspace?tab=transport` | Transport | 车辆配置、预览提交、手调、可选座号 |
| 11 field | `/activities/:activityId/workspace?tab=field` | Field | 签到/节点/位置/异常/阶段推进 |
| 12 staff | `/activities/:activityId/staff` | StaffTask | 仅分管现场任务；深链不授予权限 |
| 13 driver | `/activities/:activityId/vehicles/:vehicleId` | VehicleTask | 去返程清点、必要联系、车辆出发/结束 |
| 14 closing | 同field，phase=closing | Field | 待到家、未结异常、联系依据与归档；不另造安全名单 |

只有 `/`、`/notices`、`/me` 显示三项根Tab；详情及任务页显示返回和当前主动作。领队介绍、路线/风险、装备、费用、联系方式、座位选择使用Overlay，不扩成新频道。未知tab归overview；未知activityId展示不存在，不能归另一个活动。

### 7.2 动作审计表

| 可点击入口 | 对应领域动作/浏览器操作 | 成功后的可观察证据 | 失败保留 |
|---|---|---|---|
| 保存草稿/修改活动 | activity.create/edit | 草稿/详情重新派生，刷新仍在 | 当前步骤和输入 |
| 使用活动模板 | activity.copy | 新草稿ID、空日期、无旧人员/车辆/授权 | 原活动不变 |
| 预览 | ActivityDetail只读投影，不发publish | 显示预览标签、无报名按钮 | 编辑草稿 |
| 发布 | activity.publish | 首页/工作台可见published | 草稿不丢 |
| 分享 | 生成hash路径并复制 | 实际可直达当前浏览器已有活动 | 复制失败显示可选文字 |
| 本人/同行人报名 | signup.submit | 详情逐人资格、owner待确认计数 | 所有表单值 |
| 审核/候补提升 | signup.review/promote | 对方看到pending/confirmed，名额统一 | 原状态与选择 |
| 单人取消/明确整组取消 | signup.cancel | 所选人数、余位和车辆同步更新 | 原安排全部保留 |
| 改上车点/自行到达 | signup.edit | 旧车位释放、详情待重排、定向通知 | 原点位和车位 |
| 允许同行组分开 | group.setTogether | 预览可拆，明确显示组意愿 | 原意愿 |
| 添加/修改/删除车辆 | vehicle.save/remove | 可用位公式、司机列表、受影响范围 | 原车辆和分配 |
| 自动分车 | planAssignments | 预览差异与未分配原因，不改真实名单 | 原真实分配 |
| 确认预览/手调/交换 | assignment.commit/set/remove/swap | 个人、名单、司机任务一致 | 完整旧分配 |
| 配置/撤回协作 | membership.save/revoke | 相应账号任务出现/消失 | 原授权 |
| 签到/代签到 | attendance.checkin | 签到状态变化但上车仍未确认 | 旧签到事实 |
| 去程/返程上车 | attendance.board | 只改变选定leg | 另一程始终不变 |
| 出发结果核实 | attendance.departure | joined/not_departed/coordinating | 未核实仍显著可见 |
| 返程另行安排 | attendance.returnPlan | 记录者/时间/依据；返程应到数重算 | 不私自移出返程名单 |
| 车辆出发/结束 | vehicle.depart/complete | 本车该程状态 | 不影响其他车或home |
| 节点打卡 | attendance.node | 该人该节点时间线 | 其他节点/人员不变 |
| 上报/撤回位置 | position.report/revoke | 最新授权点或立即不可见 | 拒绝授权不写位置 |
| 报备/解决异常 | incident.report/resolve | 独立异常时间线/未结数 | 不改Signup资格 |
| 结束/归档 | activity.transition | closing或满足安全门后的archived | 未到家/异常仍可见 |
| 到家/代确认 | attendance.home | 当前人员到家，未结异常不自动减少 | 原安全缺口 |
| 发布/读通知 | notice.publish/read | 同一通知/已读在两入口一致 | 草稿/未读不伪变 |
| 复制/模拟订阅 | 浏览器操作 + notice.delivery | copied或明确模拟/失败记录 | 站内Notice不回滚 |
| 导出 | export.record + selectExport + Blob | 当前授权范围CSV和不含明文的审计 | 不下载未授权数据 |
| 我的/同行人保存 | profile.save、companion.save/remove | 常用资料更新，历史Signup快照不变 | 当前表单 |

所有行必须能指向一个测试或浏览器脚本；交付前从页面逐个点击复核，不仅搜索按钮文案。

### 7.3 页面所需的补充只读接口

§4.1 已定义 SignupFormView、TransportView、AccessView、NoticeManagementView；页面不能绕过这些投影读取State。读取接口由selectors.ts实现、runtime绑定当前身份后调用，不把actor交给页面自由传入。

```ts
selectSignupForm(state: State, actor: Actor, activityId: string, signupId: string, purpose: string, now: string): Result<SignupFormView>;
selectTransport(state: State, actor: Actor, activityId: string, now: string): Result<TransportView>;
selectAccess(state: State, actor: Actor, activityId: string, now: string): Result<AccessView>;
selectNoticeManagement(state: State, actor: Actor, activityId: string, now: string): Result<NoticeManagementView>;
```

selectSignupForm只给本人/提交者和可编辑报名的owner；owner需填写用途并通过selectSensitive同样的关系/时限检查，signup.edit再次检查purpose并记录用途，不经普通表单绕过敏感授权。其他三个接口仅owner；普通通知收件箱不含readBy和其他接收者。

ActivityView.primarySignupId默认为本人，或来自ReadRequest.selectedSignupId且验证在本人/授权代报范围；没有本人且未选代报者则为null。getDetailState按该ID判断下一步，不能取名单第一行代表本人。未报名者在active/closing不能看到签到或到家动作；PersonRowView.groupId用于同行操作。

表单新增同行人使用本人Profile投影；完整报名历史不直接携带整个Profile。runtime的这些读取方法每次绑定当前actor与now，不接受调用方传入任意actor。

## 8. 必须补实的边界与验收矩阵

### 8.1 返程例外的最小事实

两程boarding不能表达“领队核实下撤者不乘返程”；不能用取消Signup或删去程Assignment处理。§3.2 已定义 `ReturnPlanSchema` 和 `Attendance.returnPlan`，§4.1 已定义 `attendance.returnPlan` 命令，T02 即纳入模型与样本。默认assigned，independent包含操作人、时间与依据；此处只解释规则，不提供第二套待合并类型。

仅owner或对该人有incident能力的staff可记录；independent必须非空依据。只影响返程应到集合，不删除去程安排/上车事实、不自动写home。返程应到=本车已确认且已实际出行乘客，减去已核实independent；其他人未上车时司机不得出发。归档仍依照出发核实、到家及未结异常，不强制人人乘同车返程。

`field.test.ts` 加：去程已上车+返程另行安排→去程事实保留、返程应到减少、到家仍为false；车辆联系人尝试设置例外→FORBIDDEN；空依据→INVALID_INPUT。生命周期测试中的下撤场景另行记录returnPlan，不能靠司机结束任务填补安全事实。

### 8.2 固定错误语义

| 边界 | 返回/展示 | 负责测试 |
|---|---|---|
| 电话格式、紧急联系人缺失、同意未勾 | INVALID_INPUT/CONSENT_REQUIRED，字段旁解释，不清表单 | signup/ui |
| 最后一个名额与两人同行 | CAPACITY，明确整组候补选项 | signup |
| 重复提交、旧revision、请求ID异内容 | replay / CONFLICT / REQUEST_REUSED，零重复事件 | store/signup |
| pending要求上车或分车 | WRONG_PHASE，不能“确认”按钮以外偷转资格 | transport/field |
| 司机/自行到达被算未分配 | unassigned不含这些人；活动人数仍正确 | allocation |
| 增司机、减少核载、座号重复、司机重复开车 | VEHICLE_FULL/SEAT_TAKEN/DRIVER_CONFLICT，无半次保存 | transport |
| keepTogether组放不下 | 原安排保留，逐人说明；明确拆分后才能拆 | allocation |
| 到集合不等于上车、去程不等于返程 | 四种组合分别保留 | field |
| 未到人员尚未核实 | UNRESOLVED_DEPARTURE；核实未出发/协调不得假标到家 | field/lifecycle |
| 途中下撤、提前结束 | 仍confirmed、有独立incident和到家要求 | field/lifecycle |
| 位置过期、撤回、过授权期限、进入closing | 灰时刻/不显示坐标；不是失联标签 | privacy/field |
| 新账号、无分享记录、无本场授权 | 空态/只读详情/明确拒绝；不存在假的推荐与名单 | navigation/permissions |
| 任务链接转发、跨活动ID、页面打开后撤权 | FORBIDDEN/NOT_FOUND、弹层立即清敏感数据 | permissions/ui/e2e |
| 归档后再次查看医疗资料 | 工作角色拒绝，正常历史活动说明仍可看 | privacy |
| 通知外发失败/未授权/复制失败 | 明确结果，不假装送达或已读 | notices/e2e |
| 离线与localStorage不可写 | 已加载安排可读，业务写入拒绝且保留表单 | store/ui/e2e |
| 快照解析失败 | 错误恢复页，不覆盖；用户确认才重置本原型 | store/e2e |
| 天气日期范围外或暂不可用 | 无伪造温度、保留活动和日期 | ui/e2e |
| 320px、长中文、键盘、弹层返回、200%缩放 | 主操作可见，必要局部滚动，整页不横向漂移 | ui/e2e |

### 8.3 17个原始场景的去向核对

1/2/5首页、列表、我的活动→T13 ActivityHome；3详情→T13 ActivityDetail；4报名→T06/T13；6人员→T06/T10/T13；7签到→T09/T14；8/9分车分座→T07/T13；10“实时位置”→T09/T14最后手动上报点；11天气→T14；12/17通知与消息→T08/T14同一通知源；13俱乐部主页→V3不实现且不留灰入口；14领队主页→详情中本场领队资料面板；15司机→T09/T14车辆任务；16我的→T10/T14。

此次原型不增设评价/打分频道、公开领队履历等没有对应批准布局的功能；V1原规划的P2轻复盘不因本计划变成已完成。归档只提供本场真实出行/安全结果摘要，不生成虚构评分。

## 9. 分批交付与执行报告

| 批次 | 任务 | 可验证产物 | 不能声称的内容 |
|---|---|---|---|
| A 领域底座 | T01–T04 | schema、权限、原子快照、恢复和失败测试 | UI已可用/真实生产安全 |
| B 业务规则 | T05–T10 | 所有命令、不变量、四角色投影、领域测试 | 微信能力已打通 |
| C 可操作界面 | T11–T14 | 14布局、任务路由、共享状态、逐段浏览器使用 | 完整验收已通过 |
| D 验收交付 | T15–T16 | 完整生命周期、失败路径、构建、浏览器与截图证据 | 真实用户研究/上线合规/分布式并发已验证 |

每批结束报告：涉及文件、实际完成任务、执行命令与结果、未解决问题；保持工作区未提交。若共享数据契约需要偏离此计划，说明触及哪条已批准不变量，不悄悄改产品含义。

执行方式可在获授权后选择：A．当前会话由子Agent按明确文件边界逐任务实施、主执行者逐批核验；B．当前会话顺序执行并按上表检查点报告。没有明确要求不创建独立会话，不并行改共享文件。

## 10. 技术依据与本计划的验证边界

已核对的官方资料：

- React `useSyncExternalStore`：https://react.dev/reference/react/useSyncExternalStore
- React StrictMode：https://react.dev/reference/react/StrictMode
- Vite：https://vite.dev/guide/
- Vitest：https://vitest.dev/guide/
- React Router 7.18.2 HashRouter：https://reactrouter.com/7.18.2/api/declarative-routers/HashRouter
- React Router 7.18.2 useNavigate：https://reactrouter.com/7.18.2/api/hooks/useNavigate
- React Router 7.18.2 useSearchParams：https://reactrouter.com/7.18.2/api/hooks/useSearchParams

本轮完成的是计划文档和只读依赖/API核对。文中的测试是后续执行规格，尚未编译、运行；示例代码与伪码分别标明，不把计划当成源码交付。真实业务、浏览器功能、视觉对齐和性能结果均须在T01–T16执行后提供证据。

## 11. 跨端复用清单（执行后补记，按实测行数）

原型已按方案A完成：Web 页面是「可执行的设计规格」，业务规则与测试才是长期资产。

| 分类 | 文件（实测行数） | 迁移去向 | 迁移时必须替换的注入点 |
|---|---|---|---|
| 直接复用 | `src/domain/model.ts`(300)、`contracts.ts`(198)、`permissions.ts`(236)、`invariants.ts`(144)、`commands.ts`(103)、`activity.ts`(186)、`signup.ts`(176)、`transport.ts`(176)、`allocation.ts`(70)、`field.ts`(110)、`notices.ts`(41)、`profile.ts`(51)、`selectors.ts`(378)，合计2169 | `cloudfunctions/trailApi`（Node 需加构建与 zod 依赖）；投影函数可同时在小程序端调用 | `actor.userId`←微信 OPENID；`Context.now/id`←服务端时间与集合发号；`expectedRevision`/`fingerprint`←服务端计算＋数据库事务；`StoragePort`←云数据库；receipt 幂等键←唯一索引 |
| 直接复用 | `tests/{model,permissions,invariants,activity,signup,transport,allocation,field,notices,privacy,lifecycle}.test.ts` 约2400行 | 云函数仓库的单元测试 | 无 DOM、无网络、无系统时间，已验证可独立运行 |
| 按值翻译 | `src/styles/tokens.css`(59) 色板/间距/圆角/触控、`components.css`(259) 的 class 约定与14布局结构 | WXSS + WXML 结构 | WXSS 支持 CSS 变量；组件写法需重写 |
| 一次性投入 | `src/components/*.tsx`(260)、`src/screens/*.tsx`(899)、`src/app/runtime.ts`(213)、`useView.ts`(92)、`navigation.tsx`(157)、`data/store.ts`(50) 的 localStorage 路径、`tests/e2e/prototype.spec.ts` | 不迁移 | 小程序用页面栈 + `wx.navigateTo` + 云数据库；Playwright 换微信开发者工具自动化 |

交付证据（2026-09-25 实测）：`npm test` 308/308 通过（18 文件）；`npm run test:e2e` 9/9 通过（本机 Chrome，含创建→发布→报名→审核→分车→签到→上车→发车→节点→下撤→到家→归档全链路、未结异常阻归档、离线保留输入、损坏缓存不覆盖、320/390/430/1440 无横向溢出、浮层 Back 只关浮层）；`npm run build` 通过；源码内无 `fetch`/`XMLHttpRequest`/`geolocation`/`tel:`/`localStorage.clear`。原产品目录未被改动，复验 SHA256 与开工前一致：`miniprogram` 40文件 `e064c5a8…57ed`、`cloudfunctions` 6文件 `2b3281ac…4f31`、`docs/product` 7文件 `83c674ba…77c4`。

已知简化（不是缺陷，生产须还）：单标签页共享快照、预览 `baseRevision` 用全快照版本、位置与订阅均为显式模拟、留存期限待合规确认。
