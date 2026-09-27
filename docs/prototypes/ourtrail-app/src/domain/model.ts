import { z } from 'zod';

// Strict JSON records: validation does not coerce values or silently retain extra fields.
export const IdSchema = z.string().min(1).max(120);
export const TextSchema = z.string().max(2000);
export const InstantSchema = z.string().datetime({ offset: true });
export const CountSchema = z.number().int().min(0);
export const CoordinatesSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export const ContactSchema = z.strictObject({ name: TextSchema, phone: TextSchema });
export const PersonSchema = z.strictObject({
  name: TextSchema,
  phone: TextSchema,
  emergency: ContactSchema,
  medical: TextSchema,
});
export const PersonRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), userId: IdSchema }),
  z.strictObject({ kind: z.literal('companion'), ownerId: IdSchema, companionId: IdSchema }),
]);
export const CompanionSchema = z.strictObject({ id: IdSchema, person: PersonSchema });
export const ProfileSchema = z.strictObject({
  id: IdSchema,
  person: PersonSchema,
  companions: z.array(CompanionSchema),
});

export const RoutePointSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  kind: z.enum(['start', 'checkpoint', 'finish']),
  coordinates: CoordinatesSchema.nullable(),
});
export const RouteRiskSchema = z.strictObject({ id: IdSchema, title: TextSchema, advice: TextSchema });
export const RouteSchema = z.strictObject({
  id: IdSchema,
  ownerId: IdSchema,
  title: TextSchema,
  distanceKm: z.number().min(0),
  ascentM: CountSchema,
  points: z.array(RoutePointSchema),
  risks: z.array(RouteRiskSchema),
});
export const RouteSnapshotSchema = RouteSchema.omit({ id: true, ownerId: true });
export const PickupPointSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  meetingAt: InstantSchema.nullable(),
  address: TextSchema,
  coordinates: CoordinatesSchema.nullable(),
});
export const PhaseSchema = z.enum(['draft', 'published', 'gathering', 'active', 'closing', 'archived', 'cancelled']);
export const ApprovalModeSchema = z.enum(['manual', 'automatic']);
export const ActivitySchema = z.strictObject({
  id: IdSchema,
  ownerId: IdSchema,
  title: TextSchema,
  description: TextSchema,
  organizerIntro: TextSchema,
  startAt: InstantSchema.nullable(),
  endAt: InstantSchema.nullable(),
  deadlineAt: InstantSchema.nullable(),
  phase: PhaseSchema,
  acceptingSignups: z.boolean(),
  capacity: z.number().int().min(1).max(500),
  approvalMode: ApprovalModeSchema,
  routeId: IdSchema.nullable(),
  routeSnapshot: RouteSnapshotSchema,
  pickupPoints: z.array(PickupPointSchema),
  equipment: z.array(TextSchema),
  feeNote: TextSchema,
  cancellationNote: TextSchema,
});

export const TripSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('self') }),
  z.strictObject({ mode: z.literal('shared'), pickupPointId: IdSchema }),
]);
export const ConsentSchema = z.strictObject({
  at: InstantSchema,
  recordedBy: IdSchema,
  dataUse: z.literal(true),
  proxyAuthority: z.boolean(),
  proxyHome: z.boolean(),
});
export const SignupGroupSchema = z.strictObject({
  id: IdSchema,
  activityId: IdSchema,
  submittedByUserId: IdSchema,
  keepTogether: z.boolean(),
});
export const SignupStatusSchema = z.enum(['pending', 'confirmed', 'waitlisted', 'rejected', 'cancelled', 'removed']);
export const SignupSchema = z.strictObject({
  id: IdSchema,
  activityId: IdSchema,
  groupId: IdSchema,
  submittedByUserId: IdSchema,
  personRef: PersonRefSchema,
  participant: PersonSchema,
  trip: TripSchema,
  status: SignupStatusSchema,
  consent: ConsentSchema,
});

export const DriverSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('participant'), signupId: IdSchema }),
  z.strictObject({ kind: z.literal('service'), name: TextSchema, phone: TextSchema, userId: IdSchema.nullable() }),
]);
export const EvidenceSchema = z.strictObject({ at: InstantSchema, by: IdSchema, note: TextSchema });
export const LegSchema = z.enum(['outbound', 'return']);
export const VehicleLegSchema = z.strictObject({
  departed: EvidenceSchema.nullable(),
  completed: EvidenceSchema.nullable(),
});
export const SeatLabelSchema = z.string().min(1).max(12);
export const VehicleSchema = z.strictObject({
  id: IdSchema,
  activityId: IdSchema,
  label: TextSchema,
  plate: TextSchema,
  legalCapacity: z.number().int().min(1).max(60),
  drivers: z.array(DriverSchema).min(1),
  blockedSeats: CountSchema,
  seatLabels: z.array(SeatLabelSchema).nullable(),
  pickupPointIds: z.array(IdSchema),
  legs: z.strictObject({ outbound: VehicleLegSchema, return: VehicleLegSchema }),
});
export const AssignmentSchema = z.strictObject({
  activityId: IdSchema,
  signupId: IdSchema,
  vehicleId: IdSchema,
  seatLabel: z.string().nullable(),
});
export const StaffScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({ kind: z.literal('selected'), signupIds: z.array(IdSchema) }),
]);
export const CapabilitySchema = z.enum(['roster', 'checkin', 'node', 'incident', 'position', 'home', 'sensitive']);
export const StaffMembershipSchema = z.strictObject({
  role: z.literal('staff'),
  id: IdSchema,
  activityId: IdSchema,
  userId: IdSchema,
  expiresAt: InstantSchema,
  scope: StaffScopeSchema,
  capabilities: z.array(CapabilitySchema),
});
export const VehicleContactMembershipSchema = z.strictObject({
  role: z.literal('vehicle_contact'),
  id: IdSchema,
  activityId: IdSchema,
  userId: IdSchema,
  expiresAt: InstantSchema,
  vehicleId: IdSchema,
});
export const MembershipSchema = z.discriminatedUnion('role', [
  StaffMembershipSchema, VehicleContactMembershipSchema,
]);

export const DepartureSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('joined'), evidence: EvidenceSchema }),
  z.strictObject({ kind: z.literal('not_departed'), evidence: EvidenceSchema }),
  z.strictObject({ kind: z.literal('coordinating'), evidence: EvidenceSchema }),
]);
export const CheckInSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('manual'), evidence: EvidenceSchema }),
  z.strictObject({ method: z.literal('simulation'), evidence: EvidenceSchema, coordinates: CoordinatesSchema }),
]);
export const ReturnPlanSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('assigned') }),
  z.strictObject({ kind: z.literal('independent'), evidence: EvidenceSchema }),
]);
export const NodeVisitSchema = z.strictObject({ pointId: IdSchema, evidence: EvidenceSchema });
export const AttendanceSchema = z.strictObject({
  signupId: IdSchema,
  checkIn: CheckInSchema.nullable(),
  boardingByLeg: z.strictObject({ outbound: EvidenceSchema.nullable(), return: EvidenceSchema.nullable() }),
  returnPlan: ReturnPlanSchema,
  departure: DepartureSchema.nullable(),
  nodes: z.array(NodeVisitSchema),
  home: EvidenceSchema.nullable(),
});
export const PositionReportSchema = z.strictObject({
  signupId: IdSchema,
  coordinates: CoordinatesSchema,
  reportedAt: InstantSchema,
  consentExpiresAt: InstantSchema,
  revokedAt: InstantSchema.nullable(),
});
export const IncidentKindSchema = z.enum(['late', 'withdrawal', 'injury', 'other']);
export const IncidentSchema = z.strictObject({
  id: IdSchema,
  activityId: IdSchema,
  subjectIds: z.array(IdSchema).min(1),
  kind: IncidentKindSchema,
  description: TextSchema,
  opened: EvidenceSchema,
  resolution: EvidenceSchema.nullable(),
});
export const ActivityEventSchema = z.strictObject({
  id: IdSchema,
  activityId: IdSchema,
  kind: TextSchema,
  actorId: IdSchema,
  subjectIds: z.array(IdSchema),
  occurredAt: InstantSchema,
  summary: TextSchema,
});

export const AudienceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('activity') }),
  z.strictObject({ kind: z.literal('signups'), signupIds: z.array(IdSchema).min(1) }),
  z.strictObject({ kind: z.literal('vehicle'), vehicleId: IdSchema }),
]);
export const DeliveryChannelSchema = z.enum(['copy', 'subscription_simulation']);
export const DeliveryStatusSchema = z.enum(['copied', 'simulated_success', 'failed', 'not_authorized']);
export const DeliverySchema = z.strictObject({
  id: IdSchema,
  channel: DeliveryChannelSchema,
  status: DeliveryStatusSchema,
  at: InstantSchema,
  by: IdSchema,
  detail: TextSchema,
});
export const NoticeSchema = z.strictObject({
  id: IdSchema,
  activityId: IdSchema,
  audience: AudienceSchema,
  sourceEventId: IdSchema.nullable(),
  content: TextSchema,
  publishedAt: InstantSchema,
  readBy: z.record(IdSchema, InstantSchema),
  deliveries: z.array(DeliverySchema),
});
export const ReceiptSchema = z.strictObject({
  actorId: IdSchema,
  requestId: IdSchema,
  fingerprint: TextSchema,
  targetIds: z.array(IdSchema),
  appliedAt: InstantSchema,
});
export const StateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: CountSchema,
  savedAt: InstantSchema,
  profiles: z.array(ProfileSchema),
  routes: z.array(RouteSchema),
  activities: z.array(ActivitySchema),
  groups: z.array(SignupGroupSchema),
  signups: z.array(SignupSchema),
  vehicles: z.array(VehicleSchema),
  assignments: z.array(AssignmentSchema),
  memberships: z.array(MembershipSchema),
  attendance: z.array(AttendanceSchema),
  positions: z.array(PositionReportSchema),
  incidents: z.array(IncidentSchema),
  events: z.array(ActivityEventSchema),
  notices: z.array(NoticeSchema),
  receipts: z.array(ReceiptSchema),
});

export type State = z.infer<typeof StateSchema>;
export type ActivityPhase = z.infer<typeof PhaseSchema>;
export type ActivityRecord = z.infer<typeof ActivitySchema>;
export type SignupRecord = z.infer<typeof SignupSchema>;
export type SignupGroupRecord = z.infer<typeof SignupGroupSchema>;
export type VehicleRecord = z.infer<typeof VehicleSchema>;
export type AssignmentRecord = z.infer<typeof AssignmentSchema>;
export type MembershipRecord = z.infer<typeof MembershipSchema>;
export type AttendanceRecord = z.infer<typeof AttendanceSchema>;
export type NoticeRecord = z.infer<typeof NoticeSchema>;
export type ProfileRecord = z.infer<typeof ProfileSchema>;
export type Trip = z.infer<typeof TripSchema>;
export type PersonRecord = z.infer<typeof PersonSchema>;
export type PersonReference = z.infer<typeof PersonRefSchema>;
export type RouteRecord = z.infer<typeof RouteSchema>;
export type EvidenceRecord = z.infer<typeof EvidenceSchema>;
export type CoordinatesRecord = z.infer<typeof CoordinatesSchema>;
export type AudienceRecord = z.infer<typeof AudienceSchema>;
export type DepartureRecord = z.infer<typeof DepartureSchema>;
export type CheckInRecord = z.infer<typeof CheckInSchema>;
export type ContactRecord = z.infer<typeof ContactSchema>;
export type CompanionRecord = z.infer<typeof CompanionSchema>;
export type RoutePointRecord = z.infer<typeof RoutePointSchema>;
export type RouteRiskRecord = z.infer<typeof RouteRiskSchema>;
export type RouteSnapshotRecord = z.infer<typeof RouteSnapshotSchema>;
export type PickupPointRecord = z.infer<typeof PickupPointSchema>;
export type ConsentRecord = z.infer<typeof ConsentSchema>;
export type DriverRecord = z.infer<typeof DriverSchema>;
export type VehicleLegRecord = z.infer<typeof VehicleLegSchema>;
export type StaffScope = z.infer<typeof StaffScopeSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type ReturnPlanRecord = z.infer<typeof ReturnPlanSchema>;
export type PositionReportRecord = z.infer<typeof PositionReportSchema>;
export type IncidentRecord = z.infer<typeof IncidentSchema>;
export type ActivityEventRecord = z.infer<typeof ActivityEventSchema>;
export type DeliveryRecord = z.infer<typeof DeliverySchema>;
export type ReceiptRecord = z.infer<typeof ReceiptSchema>;
