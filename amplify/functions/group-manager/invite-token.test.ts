import { describe, expect, it } from 'vitest';
import {
  createInviteToken,
  InviteTokenError,
  verifyInviteToken,
} from './invite-token';

const SECRET = 'test-secret-untuk-unit-test';
const BASE_PAYLOAD = {
  groupId: 'group-123',
  memberId: 'member-456',
  email: 'siti@example.com',
  role: 'CO_OWNER' as const,
};

describe('createInviteToken', () => {
  it('menghasilkan token berformat tiga segmen JWT', () => {
    const token = createInviteToken(BASE_PAYLOAD, SECRET);
    expect(token.split('.').length).toBe(3);
  });

  it('payload dapat diverifikasi kembali', () => {
    const token = createInviteToken(BASE_PAYLOAD, SECRET);
    const payload = verifyInviteToken(token, SECRET);
    expect(payload.groupId).toBe(BASE_PAYLOAD.groupId);
    expect(payload.email).toBe(BASE_PAYLOAD.email);
    expect(payload.role).toBe(BASE_PAYLOAD.role);
  });

  it('kedaluwarsa ditetapkan ~7 hari ke depan', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = createInviteToken(BASE_PAYLOAD, SECRET);
    const payload = verifyInviteToken(token, SECRET);
    const sevenDays = 7 * 24 * 60 * 60;
    expect(payload.exp).toBeGreaterThanOrEqual(before + sevenDays - 5);
    expect(payload.exp).toBeLessThanOrEqual(before + sevenDays + 5);
  });
});

describe('verifyInviteToken', () => {
  it('menolak token dengan secret yang salah', () => {
    const token = createInviteToken(BASE_PAYLOAD, SECRET);
    expect(() => verifyInviteToken(token, 'secret-salah')).toThrow(InviteTokenError);
  });

  it('menolak token yang dimanipulasi', () => {
    const token = createInviteToken(BASE_PAYLOAD, SECRET);
    const parts = token.split('.');
    const tampered = parts[0] + '.' + parts[1] + 'X' + '.' + parts[2];
    expect(() => verifyInviteToken(tampered, SECRET)).toThrow(InviteTokenError);
  });

  it('menolak token dengan format salah', () => {
    expect(() => verifyInviteToken('tidak.valid', SECRET)).toThrow(InviteTokenError);
    expect(() => verifyInviteToken('a.b.c.d', SECRET)).toThrow(InviteTokenError);
  });

  it('kode error TOKEN_INVALID untuk token format salah', () => {
    expect(() => verifyInviteToken('a.b.c', SECRET)).toThrow(
      expect.objectContaining({ code: 'TOKEN_INVALID' }),
    );
  });
});
