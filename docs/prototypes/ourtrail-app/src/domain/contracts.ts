import { z } from 'zod';
import {
  ActivitySchema, AssignmentSchema, AudienceSchema, CheckInSchema, CoordinatesSchema,
  CountSchema, DeliveryChannelSchema, DeliveryStatusSchema, DepartureSchema,
  IdSchema, IncidentKindSchema, InstantSchema, LegSchema, MembershipSchema, NoticeSchema,
  PersonRefSchema, PersonSchema, PhaseSchema, ProfileSchema, SignupStatusSchema,
  StateSchema, TextSchema, TripSchema, VehicleSchema,
  type ActivityRecord, type VehicleRecord,
} from './model';

export const ActorSchema = z.strictObject({ userId: IdSchema.nullable() });
export type Actor = z.infer<typeof ActorSchema>;
// Context is injected code, not stored JSON and not part of CommandSchema.
export type Context = { now: string; id: (kind: string) => string };
export const ParticipantInputSchema = z.strictObject({
  personRef: PersonRefSchema,
  participant: PersonSchema,
  trip: TripSchema,
  consent: z.strictObject({ dataUse: z.boolean(), proxyAuthority: z.boolean(), proxyHome: z.boolean() }),
});
export type ParticipantInput = z.infer<typeof ParticipantInputSchema>;
export const ActivityInputSchema = ActivitySchema.omit({ id: true, ownerId: true, phase: true });
export type ActivityInput = Omit<ActivityRecord, 'id' | 'ownerId' | 'phase'>;
export const VehicleInputSchema = VehicleSchema.omit({ id: true, activityId: true, legs: true });
export type VehicleInput = Omit<VehicleRecord, 'id' | 'activityId' | 'legs'>;
export const AssignmentTargetSchema = AssignmentSchema.omit({ activityId: true });
export type AssignmentTarget = z.infer<typeof AssignmentTargetSchema>;
export const UnassignedReasonSchema = z.enum(['no_vehicle', 'pickup_mismatch', 'group_too_large', 'no_seat']);
export const AssignmentPreviewSchema = z.strictObject({
  activityId: IdSchema,
  baseRevision: CountSchema,
  assignments: z.array(AssignmentSchema),
  unassigned: z.array(z.strictObject({ signupId: IdSchema, reason: UnassignedReasonSchema })),
});
export type AssignmentPreview = z.infer<typeof AssignmentPreviewSchema>;

// Payload schemas describe inputs only. Authorization, phase rules, allocation and
// state changes belong to the command reducer, not to this contract module.
export const PayloadSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('activity.create'), input: ActivityInputSchema }),
  z.strictObject({ type: z.literal('activity.edit'), activityId: IdSchema, input: ActivityInputSchema }),
  z.strictObject({ type: z.literal('activity.copy'), sourceActivityId: IdSchema }),
  z.strictObject({ type: z.literal('activity.publish'), activityId: IdSchema, participation: ParticipantInputSchema.nullable() }),
  z.strictObject({ type: z.literal('activity.transition'), activityId: IdSchema, next: PhaseSchema, reason: TextSchema }),
  z.strictObject({ type: z.literal('signup.submit'), activityId: IdSchema, participants: z.array(ParticipantInputSchema), keepTogether: z.boolean(), mode: z.enum(['apply', 'waitlist']) }),
  z.strictObject({ type: z.literal('signup.review'), activityId: IdSchema, signupIds: z.array(IdSchema), decision: z.enum(['confirm', 'reject']) }),
  z.strictObject({ type: z.literal('signup.promote'), activityId: IdSchema, signupIds: z.array(IdSchema) }),
  z.strictObject({ type: z.literal('signup.cancel'), activityId: IdSchema, signupIds: z.array(IdSchema), reason: TextSchema }),
  z.strictObject({ type: z.literal('signup.edit'), activityId: IdSchema, signupId: IdSchema, participant: PersonSchema, trip: TripSchema, purpose: TextSchema }),
  z.strictObject({ type: z.literal('group.setTogether'), activityId: IdSchema, groupId: IdSchema, keepTogether: z.boolean() }),
  z.strictObject({ type: z.literal('vehicle.save'), activityId: IdSchema, vehicleId: IdSchema.nullable(), input: VehicleInputSchema }),
  z.strictObject({ type: z.literal('vehicle.remove'), activityId: IdSchema, vehicleId: IdSchema }),
  z.strictObject({ type: z.literal('assignment.commit'), activityId: IdSchema, preview: AssignmentPreviewSchema }),
  z.strictObject({ type: z.literal('assignment.set'), activityId: IdSchema, target: AssignmentTargetSchema }),
  z.strictObject({ type: z.literal('assignment.remove'), activityId: IdSchema, signupId: IdSchema }),
  z.strictObject({ type: z.literal('assignment.swap'), activityId: IdSchema, firstSignupId: IdSchema, secondSignupId: IdSchema }),
  z.strictObject({ type: z.literal('membership.save'), activityId: IdSchema, membership: MembershipSchema }),
  z.strictObject({ type: z.literal('membership.revoke'), activityId: IdSchema, membershipId: IdSchema }),
  z.strictObject({ type: z.literal('attendance.checkin'), activityId: IdSchema, signupId: IdSchema, checkIn: CheckInSchema }),
  z.strictObject({ type: z.literal('attendance.board'), activityId: IdSchema, signupId: IdSchema, leg: LegSchema, boarded: z.boolean(), note: TextSchema }),
  z.strictObject({ type: z.literal('attendance.departure'), activityId: IdSchema, signupId: IdSchema, outcome: DepartureSchema }),
  z.strictObject({ type: z.literal('attendance.returnPlan'), activityId: IdSchema, signupId: IdSchema, plan: z.enum(['assigned', 'independent']), note: TextSchema }),
  z.strictObject({ type: z.literal('attendance.node'), activityId: IdSchema, signupId: IdSchema, pointId: IdSchema, note: TextSchema }),
  z.strictObject({ type: z.literal('attendance.home'), activityId: IdSchema, signupId: IdSchema, note: TextSchema }),
  z.strictObject({ type: z.literal('vehicle.depart'), activityId: IdSchema, vehicleId: IdSchema, leg: LegSchema, note: TextSchema }),
  z.strictObject({ type: z.literal('vehicle.complete'), activityId: IdSchema, vehicleId: IdSchema, leg: LegSchema, note: TextSchema }),
  z.strictObject({ type: z.literal('position.report'), activityId: IdSchema, signupId: IdSchema, coordinates: CoordinatesSchema, consent: z.boolean() }),
  z.strictObject({ type: z.literal('position.revoke'), activityId: IdSchema, signupId: IdSchema }),
  z.strictObject({ type: z.literal('incident.report'), activityId: IdSchema, signupIds: z.array(IdSchema), kind: IncidentKindSchema, description: TextSchema }),
  z.strictObject({ type: z.literal('incident.resolve'), activityId: IdSchema, incidentId: IdSchema, note: TextSchema }),
  z.strictObject({ type: z.literal('notice.publish'), activityId: IdSchema, audience: AudienceSchema, content: TextSchema }),
  z.strictObject({ type: z.literal('notice.read'), activityId: IdSchema, noticeId: IdSchema }),
  z.strictObject({ type: z.literal('notice.delivery'), activityId: IdSchema, noticeId: IdSchema, channel: DeliveryChannelSchema, status: DeliveryStatusSchema, detail: TextSchema }),
  z.strictObject({ type: z.literal('export.record'), activityId: IdSchema, signupIds: z.array(IdSchema), mode: z.enum(['ordinary', 'sensitive']), purpose: TextSchema }),
  z.strictObject({ type: z.literal('profile.save'), person: PersonSchema }),
  z.strictObject({ type: z.literal('companion.save'), companionId: IdSchema.nullable(), person: PersonSchema }),
  z.strictObject({ type: z.literal('companion.remove'), companionId: IdSchema }),
]);
export type Payload = z.infer<typeof PayloadSchema>;
export const CommandSchema = z.strictObject({
  actor: ActorSchema,
  requestId: IdSchema,
  expectedRevision: CountSchema,
  fingerprint: TextSchema,
  payload: PayloadSchema,
});
export type Command = z.infer<typeof CommandSchema>;
export const ErrorCodeSchema = z.enum([
  'AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_INPUT', 'WRONG_PHASE', 'CONFLICT',
  'REQUEST_REUSED', 'CAPACITY', 'DUPLICATE_PERSON', 'GROUP_SCOPE', 'VEHICLE_FULL',
  'SEAT_TAKEN', 'PICKUP_MISMATCH', 'DRIVER_CONFLICT', 'UNRESOLVED_DEPARTURE',
  'UNRESOLVED_SAFETY', 'CONSENT_REQUIRED', 'STORAGE_UNAVAILABLE', 'OFFLINE', 'CORRUPT_SNAPSHOT',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const DomainErrorSchema = z.strictObject({
  code: ErrorCodeSchema,
  message: TextSchema,
  fieldErrors: z.record(z.string(), z.string()).optional(),
});
export type DomainError = z.infer<typeof DomainErrorSchema>;
export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };
export const AppliedSchema = z.strictObject({ state: StateSchema, targetIds: z.array(IdSchema), replayed: z.boolean() });
export type Applied = z.infer<typeof AppliedSchema>;
export type DispatchResult = Result<{ targetIds: string[]; replayed: boolean }>;

export const PerspectiveSchema = z.enum(['participant', 'organizer', 'staff', 'vehicle']);
export type Perspective = z.infer<typeof PerspectiveSchema>;
export const ReadRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('home'), perspective: PerspectiveSchema, openedActivityIds: z.array(IdSchema) }),
  z.strictObject({ kind: z.literal('activity'), activityId: IdSchema, perspective: PerspectiveSchema, vehicleId: IdSchema.optional(), selectedSignupId: IdSchema.optional() }),
  z.strictObject({ kind: z.literal('notices'), activityId: IdSchema.optional() }),
  z.strictObject({ kind: z.literal('profile') }),
]);
export type ReadRequest = z.infer<typeof ReadRequestSchema>;
export const PersonRowViewSchema = z.strictObject({
  signupId: IdSchema,
  groupId: IdSchema,
  name: TextSchema,
  status: SignupStatusSchema,
  pickup: TextSchema,
  vehicle: TextSchema,
  seat: z.string().nullable(),
  checkedIn: z.boolean(),
  outboundBoarded: z.boolean(),
  returnBoarded: z.boolean(),
  returnPlan: z.enum(['assigned', 'independent']),
  departure: z.enum(['unknown', 'joined', 'not_departed', 'coordinating']),
  home: z.boolean(),
});
export type PersonRowView = z.infer<typeof PersonRowViewSchema>;
export const ActivityViewSchema = z.strictObject({
  kind: z.literal('activity'),
  activity: ActivitySchema,
  perspective: PerspectiveSchema,
  primarySignupId: IdSchema.nullable(),
  rows: z.array(PersonRowViewSchema),
  counters: z.strictObject({
    confirmed: z.number(), pending: z.number(), occupied: z.number(), waitlisted: z.number(),
    remaining: z.number(), unassigned: z.number(), unchecked: z.number(), pendingHome: z.number(), openIncidents: z.number(),
  }),
  permittedActions: z.array(z.union(PayloadSchema.options.map((option) => option.shape.type))),
  vehicleTask: z.strictObject({
    vehicle: VehicleSchema,
    passengers: z.array(PersonRowViewSchema.extend({ phone: TextSchema })),
  }).nullable(),
  positions: z.array(z.strictObject({
    signupId: IdSchema, name: TextSchema, coordinates: CoordinatesSchema, reportedAt: InstantSchema, stale: z.boolean(),
  })),
  incidents: z.array(z.strictObject({
    id: IdSchema, subjectIds: z.array(IdSchema), kind: IncidentKindSchema, description: TextSchema, resolved: z.boolean(),
  })),
});
export type ActivityView = z.infer<typeof ActivityViewSchema>;
export const AuthorizedViewSchema = z.discriminatedUnion('kind', [
  ActivityViewSchema,
  z.strictObject({ kind: z.literal('home'), activities: z.array(ActivitySchema) }),
  z.strictObject({ kind: z.literal('notices'), notices: z.array(z.strictObject({
    id: IdSchema, activityId: IdSchema, content: TextSchema, publishedAt: InstantSchema, read: z.boolean(),
  })) }),
  z.strictObject({ kind: z.literal('profile'), profile: ProfileSchema }),
  z.strictObject({ kind: z.literal('denied'), code: z.enum(['AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND']), message: TextSchema }),
]);
export type AuthorizedView = z.infer<typeof AuthorizedViewSchema>;
export const SensitiveViewSchema = z.strictObject({
  signupId: IdSchema, emergency: PersonSchema.shape.emergency, medical: TextSchema,
});
export type SensitiveView = z.infer<typeof SensitiveViewSchema>;
export const SignupFormViewSchema = z.strictObject({ signupId: IdSchema, groupId: IdSchema, input: ParticipantInputSchema });
export type SignupFormView = z.infer<typeof SignupFormViewSchema>;
export const TransportViewSchema = z.strictObject({
  vehicles: z.array(VehicleSchema),
  assignments: z.array(AssignmentSchema),
  groups: z.array(z.strictObject({ id: IdSchema, keepTogether: z.boolean(), signupIds: z.array(IdSchema) })),
});
export type TransportView = z.infer<typeof TransportViewSchema>;
export const AccessViewSchema = z.strictObject({ memberships: z.array(MembershipSchema) });
export type AccessView = z.infer<typeof AccessViewSchema>;
export const NoticeManagementViewSchema = z.strictObject({ notices: z.array(NoticeSchema) });
export type NoticeManagementView = z.infer<typeof NoticeManagementViewSchema>;
export const WeatherResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready'), updatedAt: InstantSchema, hours: z.array(z.strictObject({
    at: InstantSchema, temperature: z.number(), precipitation: z.number(), wind: TextSchema,
  })) }),
  z.strictObject({ status: z.literal('out_of_range') }),
  z.strictObject({ status: z.literal('unavailable'), message: TextSchema }),
]);
export type WeatherResult = z.infer<typeof WeatherResultSchema>;

/** Canonical JSON for an already schema-validated payload; array order is significant. */
export function canonicalPayload(payload: Payload): string {
  function serialize(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)!;
    if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(',')}}`;
  }
  return serialize(payload);
}
