/**
 * Token undangan JWT sederhana menggunakan HS256.
 *
 * Implementasi murni Node.js `crypto` tanpa dependensi eksternal.
 * Token memuat: groupId, inviteeEmail, role, dan waktu kedaluwarsa.
 *
 * Token hanya berlaku selama masa undangan (7 hari). Setelah diterima,
 * `status` pada `GroupMember` berubah menjadi ACTIVE sehingga token
 * tidak dapat dipakai ulang meskipun belum kedaluwarsa.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type InviteRole = 'CO_OWNER' | 'VIEWER';

export interface InvitePayload {
  /** ID grup yang diundang. */
  groupId: string;
  /** ID anggota (GroupMember.id) yang berkaitan dengan undangan ini. */
  memberId: string;
  /** Email yang diundang; divalidasi saat penerimaan. */
  email: string;
  /** Peran yang diberikan saat bergabung. */
  role: InviteRole;
  /** Epoch seconds kedaluwarsa (iat + 7 hari). */
  exp: number;
}

const HEADER_B64 = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function toBase64Url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function fromBase64Url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

function sign(unsigned: string, secret: string): string {
  return createHmac('sha256', secret).update(unsigned).digest('base64url');
}

/**
 * Membuat token undangan JWT HS256.
 *
 * @param payload - data undangan (tanpa `exp`; diisi otomatis 7 hari)
 * @param secret  - `GROUP_INVITE_SECRET` dari environment
 */
export function createInviteToken(
  payload: Omit<InvitePayload, 'exp'>,
  secret: string,
): string {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const body = toBase64Url(JSON.stringify({ ...payload, exp }));
  const unsigned = `${HEADER_B64}.${body}`;
  const sig = sign(unsigned, secret);
  return `${unsigned}.${sig}`;
}

export class InviteTokenError extends Error {
  constructor(
    public readonly code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'InviteTokenError';
  }
}

/**
 * Memverifikasi token undangan.
 *
 * @throws {InviteTokenError} bila token tidak valid atau kedaluwarsa
 */
export function verifyInviteToken(token: string, secret: string): InvitePayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new InviteTokenError('TOKEN_INVALID', 'Format token tidak valid');
  }
  const [h, b, s] = parts as [string, string, string];

  const expectedSig = sign(`${h}.${b}`, secret);
  const actualSigBuf = Buffer.from(s, 'base64url');
  const expectedSigBuf = Buffer.from(expectedSig, 'base64url');

  if (
    actualSigBuf.length !== expectedSigBuf.length ||
    !timingSafeEqual(actualSigBuf, expectedSigBuf)
  ) {
    throw new InviteTokenError('TOKEN_INVALID', 'Tanda tangan token tidak valid');
  }

  let payload: InvitePayload;
  try {
    payload = JSON.parse(fromBase64Url(b)) as InvitePayload;
  } catch {
    throw new InviteTokenError('TOKEN_INVALID', 'Isi token tidak dapat dibaca');
  }

  if (Date.now() / 1000 > payload.exp) {
    throw new InviteTokenError('TOKEN_EXPIRED', 'Token undangan sudah kedaluwarsa');
  }

  return payload;
}
