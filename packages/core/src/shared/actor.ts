import type {
  AgentId,
  DeviceId,
  MemberId,
  MigrationRunId,
  StaffUserId,
  SystemJobId,
} from './ids'

// Every actor is a first-class principal (D4). All nine variants exist from the
// first commit; four are unused in Phase 1 but cannot be retrofitted onto events
// already written (Doc 4 §5). No actor ever borrows another's identity — the
// nightly sweep is `system`, never "the owner".
export type ActorRef =
  | { readonly type: 'owner'; readonly id: StaffUserId }
  | { readonly type: 'receptionist'; readonly id: StaffUserId }
  | { readonly type: 'trainer'; readonly id: StaffUserId }
  | { readonly type: 'member'; readonly id: MemberId }
  | { readonly type: 'system'; readonly id: SystemJobId }
  | { readonly type: 'ai_agent'; readonly id: AgentId }
  | { readonly type: 'device'; readonly id: DeviceId }
  | { readonly type: 'migration'; readonly id: MigrationRunId }
  | {
      readonly type: 'platform_admin'
      readonly id: StaffUserId
      readonly impersonating?: StaffUserId
    }

export type ActorType = ActorRef['type']
