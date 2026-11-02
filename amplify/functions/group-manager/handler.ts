/**
 * Handler Lambda `group-manager`.
 *
 * Menangani seluruh operasi Keuangan Bersama lewat AppSync custom
 * mutations/queries. Setiap operasi memvalidasi identitas dan peran
 * sebelum mengeksekusi perubahan DynamoDB.
 *
 * Operasi yang tersedia (fieldName):
 * - createGroup          : buat grup baru
 * - inviteMember         : kirim undangan email
 * - resendInvitation     : kirim ulang undangan yang kedaluwarsa
 * - acceptInvitation     : terima undangan via token
 * - declineInvitation    : tolak undangan
 * - updateMemberRole     : ubah peran anggota (Owner only)
 * - removeMember         : hapus anggota dari grup (Owner only)
 * - leaveGroup           : anggota meninggalkan grup
 * - disbandGroup         : bubarkan grup (Owner only)
 * - getMyGroupContext     : info semua grup pengguna
 * - listGroupMembersDetail: daftar anggota + status (Owner only)
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import type { InviteRole } from './invite-token';
import { createInviteToken, InviteTokenError, verifyInviteToken } from './invite-token';
import { sendInvitationEmail } from './ses-client';

// ---------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------

/** Identitas Cognito dari event AppSync. */
interface CallerIdentity {
  sub?: string | null;
  username?: string | null;
  claims?: Record<string, unknown> | null;
}

interface AppSyncEvent {
  info?: { fieldName?: string | null } | null;
  fieldName?: string | null;
  arguments?: { input?: unknown } | null;
  identity?: CallerIdentity | null;
}

interface GroupMemberRecord {
  id: string;
  groupId: string;
  groupOwnerSub: string;
  inviteeEmail: string;
  inviteeSub?: string;
  role: InviteRole | 'OWNER';
  status: 'PENDING' | 'ACTIVE' | 'REMOVED' | 'DECLINED';
  token?: string;
  tokenExpiresAt?: string;
  invitedAt: string;
  acceptedAt?: string;
  owner: string; // Amplify owner field
}

interface SharedGroupRecord {
  id: string;
  name: string;
  owner: string; // sub::username — Amplify owner field
  createdAt: string;
  updatedAt: string;
  status?: 'ACTIVE' | 'DISBANDED';
}

// ---------------------------------------------------------------------------
// DynamoDB
// ---------------------------------------------------------------------------

function makeClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

let _client: DynamoDBDocumentClient | undefined;
function getDocClient(): DynamoDBDocumentClient {
  if (!_client) _client = makeClient();
  return _client;
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Variabel lingkungan ${key} belum diset`);
  return v;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

type GroupErrorCode =
  | 'UNAUTHENTICATED'
  | 'GROUP_NOT_FOUND'
  | 'ALREADY_OWNER'
  | 'GROUP_FULL'
  | 'ALREADY_MEMBER'
  | 'FORBIDDEN'
  | 'INVITATION_NOT_FOUND'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'EMAIL_MISMATCH'
  | 'UNKNOWN_OPERATION'
  | 'INTERNAL_ERROR';

class GroupError extends Error {
  constructor(
    public readonly code: GroupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GroupError';
  }
}

type Envelope<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

function ok<T>(data: T): Envelope<T> {
  return { ok: true, data };
}
function fail(code: string, message: string): Envelope<never> {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Helper identitas
// ---------------------------------------------------------------------------

function requireSub(identity: CallerIdentity | null | undefined): string {
  const sub = identity?.sub?.trim();
  if (!sub) throw new GroupError('UNAUTHENTICATED', 'Identitas pengguna tidak valid');
  return sub;
}

function ownerField(identity: CallerIdentity): string {
  const sub = identity.sub ?? '';
  const username = identity.username ?? '';
  return `${sub}::${username}`;
}

function callerEmail(identity: CallerIdentity): string | undefined {
  return identity.claims?.email as string | undefined;
}

function displayName(identity: CallerIdentity): string {
  const email = callerEmail(identity) ?? '';
  return email.split('@')[0] ?? 'Pengguna';
}

// ---------------------------------------------------------------------------
// Tabel helpers
// ---------------------------------------------------------------------------

function groupTable(): string {
  return requireEnv('SHARED_GROUP_TABLE_NAME');
}
function memberTable(): string {
  return requireEnv('GROUP_MEMBER_TABLE_NAME');
}

async function getGroup(id: string): Promise<SharedGroupRecord | null> {
  const r = await getDocClient().send(
    new GetCommand({ TableName: groupTable(), Key: { id } }),
  );
  return (r.Item as SharedGroupRecord | undefined) ?? null;
}

async function getGroupByOwnerSub(ownerSub: string): Promise<SharedGroupRecord | null> {
  // Scan (bukan GSI Query) karena ownerSub tidak didefinisikan sebagai secondary index
  // di skema. Untuk aplikasi personal dengan jumlah grup kecil ini sudah cukup.
  let lastKey: Record<string, unknown> | undefined;
  do {
    const r = await getDocClient().send(
      new ScanCommand({
        TableName: groupTable(),
        FilterExpression: 'ownerSub = :s',
        ExpressionAttributeValues: { ':s': ownerSub },
        ExclusiveStartKey: lastKey,
      }),
    );
    const found = (r.Items as SharedGroupRecord[]).find((g) => g.status !== 'DISBANDED');
    if (found) return found;
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return null;
}

async function getMembersByGroup(groupId: string): Promise<GroupMemberRecord[]> {
  const items: GroupMemberRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const r = await getDocClient().send(
      new ScanCommand({
        TableName: memberTable(),
        FilterExpression: 'groupId = :g',
        ExpressionAttributeValues: { ':g': groupId },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of r.Items ?? []) items.push(item as GroupMemberRecord);
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function getMembersByInviteeSub(inviteeSub: string): Promise<GroupMemberRecord[]> {
  const items: GroupMemberRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const r = await getDocClient().send(
      new ScanCommand({
        TableName: memberTable(),
        FilterExpression: 'inviteeSub = :s',
        ExpressionAttributeValues: { ':s': inviteeSub },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of r.Items ?? []) items.push(item as GroupMemberRecord);
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function getMember(id: string): Promise<GroupMemberRecord | null> {
  const r = await getDocClient().send(
    new GetCommand({ TableName: memberTable(), Key: { id } }),
  );
  return (r.Item as GroupMemberRecord | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Operasi
// ---------------------------------------------------------------------------

async function createGroup(
  identity: CallerIdentity,
  input: Record<string, unknown>,
): Promise<Envelope> {
  const sub = requireSub(identity);
  const owner = ownerField(identity);

  const name = (input.name as string | undefined)?.trim();
  if (!name || name.length < 1 || name.length > 60) {
    return fail('VALIDATION_ERROR', 'Nama grup harus 1–60 karakter');
  }

  // Cek sudah punya grup
  const existing = await getGroupByOwnerSub(sub);
  if (existing && existing.status !== 'DISBANDED') {
    return fail('ALREADY_OWNER', 'Anda sudah memiliki grup aktif');
  }

  const groupId = randomUUID();
  const ts = nowIso();

  const group: SharedGroupRecord & { ownerSub: string } = {
    id: groupId,
    name,
    owner,
    ownerSub: sub,
    createdAt: ts,
    updatedAt: ts,
    status: 'ACTIVE',
    __typename: 'SharedGroup',
  } as unknown as SharedGroupRecord & { ownerSub: string };

  await getDocClient().send(new PutCommand({ TableName: groupTable(), Item: group }));

  // Pemilik sebagai anggota pertama
  const memberId = randomUUID();
  const ownerMember: GroupMemberRecord = {
    id: memberId,
    groupId,
    groupOwnerSub: sub,
    inviteeEmail: (callerEmail(identity) ?? owner) as string,
    inviteeSub: sub,
    role: 'OWNER',
    status: 'ACTIVE',
    invitedAt: ts,
    acceptedAt: ts,
    owner,
    __typename: 'GroupMember',
  } as unknown as GroupMemberRecord;

  await getDocClient().send(new PutCommand({ TableName: memberTable(), Item: ownerMember }));

  return ok({ groupId, name, memberId });
}

async function inviteMember(
  identity: CallerIdentity,
  input: Record<string, unknown>,
): Promise<Envelope> {
  const sub = requireSub(identity);
  const group = await getGroupByOwnerSub(sub);
  if (!group || group.status === 'DISBANDED') {
    return fail('GROUP_NOT_FOUND', 'Grup tidak ditemukan atau sudah dibubarkan');
  }

  const inviteeEmail = (input.email as string | undefined)?.trim().toLowerCase();
  if (!inviteeEmail) return fail('VALIDATION_ERROR', 'Email wajib diisi');

  const role = input.role as InviteRole | undefined;
  if (!role || !['CO_OWNER', 'VIEWER'].includes(role)) {
    return fail('VALIDATION_ERROR', 'Peran harus CO_OWNER atau VIEWER');
  }

  const members = await getMembersByGroup(group.id);
  if (members.filter((m) => m.status === 'ACTIVE').length >= 5) {
    return fail('GROUP_FULL', 'Grup sudah penuh (maksimal 5 anggota)');
  }

  const already = members.find(
    (m) => m.inviteeEmail === inviteeEmail && m.status === 'ACTIVE',
  );
  if (already) return fail('ALREADY_MEMBER', 'Email ini sudah menjadi anggota aktif');

  const secret = requireEnv('GROUP_INVITE_SECRET');
  const memberId = randomUUID();
  const ts = nowIso();
  const token = createInviteToken({ groupId: group.id, memberId, email: inviteeEmail, role }, secret);
  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const memberRecord: GroupMemberRecord & Record<string, unknown> = {
    id: memberId,
    groupId: group.id,
    groupOwnerSub: sub,
    inviteeEmail,
    role,
    status: 'PENDING',
    token,
    tokenExpiresAt,
    invitedAt: ts,
    owner: ownerField(identity),
    __typename: 'GroupMember',
  };

  await getDocClient().send(new PutCommand({ TableName: memberTable(), Item: memberRecord }));

  const baseUrl = requireEnv('INVITE_BASE_URL');
  const inviteUrl = `${baseUrl}/bergabung?token=${encodeURIComponent(token)}`;

  await sendInvitationEmail({
    to: inviteeEmail,
    fromEmail: requireEnv('SES_FROM_EMAIL'),
    inviterName: displayName(identity),
    groupName: group.name,
    role,
    inviteUrl,
  });

  return ok({ memberId, inviteeEmail, role, tokenExpiresAt });
}

async function resendInvitation(
  identity: CallerIdentity,
  input: Record<string, unknown>,
): Promise<Envelope> {
  const sub = requireSub(identity);
  const memberId = input.memberId as string | undefined;
  if (!memberId) return fail('VALIDATION_ERROR', 'memberId wajib diisi');

  const member = await getMember(memberId);
  if (!member) return fail('INVITATION_NOT_FOUND', 'Undangan tidak ditemukan');
  if (member.groupOwnerSub !== sub) return fail('FORBIDDEN', 'Hanya pemilik grup yang bisa kirim ulang undangan');

  const group = await getGroup(member.groupId);
  if (!group) return fail('GROUP_NOT_FOUND', 'Grup tidak ditemukan');

  const secret = requireEnv('GROUP_INVITE_SECRET');
  const newToken = createInviteToken(
    { groupId: member.groupId, memberId, email: member.inviteeEmail, role: member.role as InviteRole },
    secret,
  );
  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await getDocClient().send(new UpdateCommand({
    TableName: memberTable(),
    Key: { id: memberId },
    UpdateExpression: 'SET #tok = :t, tokenExpiresAt = :exp, #st = :s, updatedAt = :u',
    ExpressionAttributeNames: { '#tok': 'token', '#st': 'status' },
    ExpressionAttributeValues: { ':t': newToken, ':exp': tokenExpiresAt, ':s': 'PENDING', ':u': nowIso() },
  }));

  const baseUrl = requireEnv('INVITE_BASE_URL');
  const inviteUrl = `${baseUrl}/bergabung?token=${encodeURIComponent(newToken)}`;

  await sendInvitationEmail({
    to: member.inviteeEmail,
    fromEmail: requireEnv('SES_FROM_EMAIL'),
    inviterName: displayName(identity),
    groupName: group.name,
    role: member.role as InviteRole,
    inviteUrl,
  });

  return ok({ memberId, tokenExpiresAt });
}

async function acceptInvitation(
  identity: CallerIdentity,
  input: Record<string, unknown>,
): Promise<Envelope> {
  const sub = requireSub(identity);
  const token = input.token as string | undefined;
  if (!token) return fail('TOKEN_INVALID', 'Token wajib diisi');

  const secret = requireEnv('GROUP_INVITE_SECRET');
  let payload;
  try {
    payload = verifyInviteToken(token, secret);
  } catch (e) {
    if (e instanceof InviteTokenError) return fail(e.code, e.message);
    throw e;
  }

  // Validasi email
  const callerMail = callerEmail(identity)?.toLowerCase();
  if (callerMail && callerMail !== payload.email.toLowerCase()) {
    return fail('EMAIL_MISMATCH', 'Undangan ini ditujukan untuk alamat email yang berbeda');
  }

  const member = await getMember(payload.memberId);
  if (!member) return fail('INVITATION_NOT_FOUND', 'Undangan tidak ditemukan');
  if (member.status !== 'PENDING') {
    return fail('TOKEN_INVALID', 'Undangan ini sudah diproses sebelumnya');
  }

  await getDocClient().send(new UpdateCommand({
    TableName: memberTable(),
    Key: { id: payload.memberId },
    UpdateExpression: 'SET #st = :a, inviteeSub = :sub, acceptedAt = :ts, updatedAt = :ts REMOVE #tok',
    ExpressionAttributeNames: { '#st': 'status', '#tok': 'token' },
    ExpressionAttributeValues: { ':a': 'ACTIVE', ':sub': sub, ':ts': nowIso() },
  }));

  const group = await getGroup(payload.groupId);
  return ok({ groupId: payload.groupId, groupName: group?.name, role: payload.role });
}

async function declineInvitation(
  identity: CallerIdentity,
  input: Record<string, unknown>,
): Promise<Envelope> {
  const token = input.token as string | undefined;
  if (!token) return fail('TOKEN_INVALID', 'Token wajib diisi');

  const secret = requireEnv('GROUP_INVITE_SECRET');
  let payload;
  try {
    payload = verifyInviteToken(token, secret);
  } catch (e) {
    if (e instanceof InviteTokenError) return fail(e.code, e.message);
    throw e;
  }

  const member = await getMember(payload.memberId);
  if (!member || member.status !== 'PENDING') {
    return fail('INVITATION_NOT_FOUND', 'Undangan tidak ditemukan atau sudah diproses');
  }

  await getDocClient().send(new UpdateCommand({
    TableName: memberTable(),
    Key: { id: payload.memberId },
    UpdateExpression: 'SET #st = :d, updatedAt = :ts REMOVE #tok',
    ExpressionAttributeNames: { '#st': 'status', '#tok': 'token' },
    ExpressionAttributeValues: { ':d': 'DECLINED', ':ts': nowIso() },
  }));

  return ok({ declined: true });
}

async function updateMemberRole(
  identity: CallerIdentity,
  input: Record<string, unknown>,
): Promise<Envelope> {
  const sub = requireSub(identity);
  const memberId = input.memberId as string | undefined;
  const newRole = input.role as InviteRole | undefined;
  if (!memberId || !newRole) return fail('VALIDATION_ERROR', 'memberId dan role wajib diisi');
  if (!['CO_OWNER', 'VIEWER'].includes(newRole)) return fail('VALIDATION_ERROR', 'Peran tidak valid');

  const member = await getMember(memberId);
  if (!member || member.status !== 'ACTIVE') return fail('INVITATION_NOT_FOUND', 'Anggota tidak ditemukan');
  if (member.groupOwnerSub !== sub) return fail('FORBIDDEN', 'Hanya pemilik grup yang bisa mengubah peran');
  if (member.role === 'OWNER') return fail('FORBIDDEN', 'Peran pemilik tidak bisa diubah');

  await getDocClient().send(new UpdateCommand({
    TableName: memberTable(),
    Key: { id: memberId },
    UpdateExpression: 'SET #r = :r, updatedAt = :ts',
    ExpressionAttributeNames: { '#r': 'role' },
    ExpressionAttributeValues: { ':r': newRole, ':ts': nowIso() },
  }));

  return ok({ memberId, role: newRole });
}

async function removeMember(
  identity: CallerIdentity,
  input: Record<string, unknown>,
): Promise<Envelope> {
  const sub = requireSub(identity);
  const memberId = input.memberId as string | undefined;
  if (!memberId) return fail('VALIDATION_ERROR', 'memberId wajib diisi');

  const member = await getMember(memberId);
  if (!member) return fail('INVITATION_NOT_FOUND', 'Anggota tidak ditemukan');
  if (member.groupOwnerSub !== sub) return fail('FORBIDDEN', 'Hanya pemilik grup yang bisa menghapus anggota');
  if (member.role === 'OWNER') return fail('FORBIDDEN', 'Pemilik tidak bisa menghapus diri sendiri');

  await getDocClient().send(new UpdateCommand({
    TableName: memberTable(),
    Key: { id: memberId },
    UpdateExpression: 'SET #st = :r, updatedAt = :ts',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':r': 'REMOVED', ':ts': nowIso() },
  }));

  return ok({ removed: true, memberId });
}

async function leaveGroup(
  identity: CallerIdentity,
  input: Record<string, unknown>,
): Promise<Envelope> {
  const sub = requireSub(identity);
  const groupId = input.groupId as string | undefined;
  if (!groupId) return fail('VALIDATION_ERROR', 'groupId wajib diisi');

  const members = await getMembersByGroup(groupId);
  const myMember = members.find((m) => m.inviteeSub === sub && m.status === 'ACTIVE');
  if (!myMember) return fail('INVITATION_NOT_FOUND', 'Anda bukan anggota aktif grup ini');
  if (myMember.role === 'OWNER') return fail('FORBIDDEN', 'Pemilik tidak bisa meninggalkan grup; gunakan bubarkan grup');

  await getDocClient().send(new UpdateCommand({
    TableName: memberTable(),
    Key: { id: myMember.id },
    UpdateExpression: 'SET #st = :r, updatedAt = :ts',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':r': 'REMOVED', ':ts': nowIso() },
  }));

  return ok({ left: true });
}

async function disbandGroup(
  identity: CallerIdentity,
  input: Record<string, unknown>,
): Promise<Envelope> {
  const sub = requireSub(identity);
  const group = await getGroupByOwnerSub(sub);
  if (!group || group.status === 'DISBANDED') return fail('GROUP_NOT_FOUND', 'Grup tidak ditemukan');

  const groupId = input.groupId as string | undefined;
  if (groupId && groupId !== group.id) return fail('FORBIDDEN', 'Anda bukan pemilik grup ini');

  // Hapus semua keanggotaan
  const members = await getMembersByGroup(group.id);
  await Promise.all(members.map((m) =>
    getDocClient().send(new UpdateCommand({
      TableName: memberTable(),
      Key: { id: m.id },
      UpdateExpression: 'SET #st = :r, updatedAt = :ts',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':r': 'REMOVED', ':ts': nowIso() },
    })),
  ));

  // Tandai grup sebagai dibubarkan
  await getDocClient().send(new UpdateCommand({
    TableName: groupTable(),
    Key: { id: group.id },
    UpdateExpression: 'SET #st = :d, updatedAt = :ts',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':d': 'DISBANDED', ':ts': nowIso() },
  }));

  return ok({ disbanded: true });
}

async function getMyGroupContext(identity: CallerIdentity): Promise<Envelope> {
  const sub = requireSub(identity);

  // Grup yang saya miliki
  const ownedGroup = await getGroupByOwnerSub(sub);

  // Grup di mana saya adalah anggota
  const memberships = await getMembersByInviteeSub(sub);
  const activeMemberships = memberships.filter((m) => m.status === 'ACTIVE');

  const contexts = await Promise.all(
    activeMemberships.map(async (m) => {
      const group = await getGroup(m.groupId);
      if (!group || group.status === 'DISBANDED') return null;
      return {
        groupId: group.id,
        groupName: group.name,
        role: m.role,
        isOwner: m.role === 'OWNER',
        memberCount: 0, // diisi terpisah bila perlu
      };
    }),
  );

  return ok({
    ownedGroupId: ownedGroup?.status === 'ACTIVE' ? ownedGroup.id : null,
    groups: contexts.filter(Boolean),
  });
}

async function listGroupMembersDetail(
  identity: CallerIdentity,
  input: Record<string, unknown>,
): Promise<Envelope> {
  const sub = requireSub(identity);
  const groupId = input.groupId as string | undefined;
  if (!groupId) return fail('VALIDATION_ERROR', 'groupId wajib diisi');

  const group = await getGroup(groupId);
  if (!group) return fail('GROUP_NOT_FOUND', 'Grup tidak ditemukan');
  if (group.owner.split('::')[0] !== sub) {
    // Anggota non-owner bisa lihat daftar anggota juga
    const members = await getMembersByGroup(groupId);
    const isMember = members.some((m) => m.inviteeSub === sub && m.status === 'ACTIVE');
    if (!isMember) return fail('FORBIDDEN', 'Anda bukan anggota grup ini');
  }

  const members = await getMembersByGroup(groupId);
  return ok({
    groupId,
    groupName: group.name,
    members: members.map((m) => ({
      id: m.id,
      email: m.inviteeEmail,
      role: m.role,
      status: m.status,
      invitedAt: m.invitedAt,
      acceptedAt: m.acceptedAt,
      tokenExpiresAt: m.tokenExpiresAt,
    })),
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function parseInput(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

export const handler = async (event: AppSyncEvent): Promise<Envelope> => {
  const fieldName = (event.info?.fieldName ?? event.fieldName ?? '') as string;
  const identity = event.identity ?? null;
  const input = parseInput(event.arguments?.input);

  try {
    switch (fieldName) {
      case 'createGroup': return createGroup(identity!, input);
      case 'inviteMember': return inviteMember(identity!, input);
      case 'resendInvitation': return resendInvitation(identity!, input);
      case 'acceptInvitation': return acceptInvitation(identity!, input);
      case 'declineInvitation': return declineInvitation(identity!, input);
      case 'updateMemberRole': return updateMemberRole(identity!, input);
      case 'removeMember': return removeMember(identity!, input);
      case 'leaveGroup': return leaveGroup(identity!, input);
      case 'disbandGroup': return disbandGroup(identity!, input);
      case 'getMyGroupContext': return getMyGroupContext(identity!);
      case 'listGroupMembersDetail': return listGroupMembersDetail(identity!, input);
      default:
        return fail('UNKNOWN_OPERATION', `Operasi tidak dikenal: ${fieldName}`);
    }
  } catch (e) {
    if (e instanceof GroupError) return fail(e.code, e.message);
    console.error('Galat group-manager tak terduga', {
      field: fieldName,
      name: (e as { name?: string })?.name,
    });
    return fail('INTERNAL_ERROR', 'Terjadi kesalahan internal');
  }
};
