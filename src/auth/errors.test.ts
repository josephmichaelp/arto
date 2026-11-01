/**
 * Uji unit untuk `src/auth/errors.ts` (Tugas 12.2).
 *
 * Cakupan:
 *  - mapLoginError memetakan NotAuthorizedException dan UserNotFoundException
 *    ke satu pesan seragam (Req 1.4).
 *  - Pesan mentah Cognito yang dikenal juga dipetakan ke pesan seragam.
 *  - Galat tak dikenal mengembalikan pesannya sendiri atau LOGIN_ERROR_FALLBACK.
 *  - LOGIN_ERROR_VOCABULARY memuat semua pasangan yang benar.
 */

import { describe, expect, it } from 'vitest';

import {
  LOGIN_ERROR_FALLBACK,
  LOGIN_ERROR_GENERIC,
  LOGIN_ERROR_VOCABULARY,
  mapLoginError,
} from './errors';

// ---------------------------------------------------------------------------
// 1. Galat kredensial seragam – berdasarkan nama (Req 1.4)
// ---------------------------------------------------------------------------

describe('mapLoginError – Req 1.4: galat kredensial seragam berdasarkan nama', () => {
  it('memetakan NotAuthorizedException (Error object) ke pesan seragam', () => {
    const err = Object.assign(new Error('Incorrect username or password.'), {
      name: 'NotAuthorizedException',
    });
    expect(mapLoginError(err)).toBe(LOGIN_ERROR_GENERIC);
  });

  it('memetakan UserNotFoundException (Error object) ke pesan seragam', () => {
    const err = Object.assign(new Error('User does not exist.'), {
      name: 'UserNotFoundException',
    });
    expect(mapLoginError(err)).toBe(LOGIN_ERROR_GENERIC);
  });

  it('memetakan plain object {name: NotAuthorizedException} ke pesan seragam', () => {
    expect(
      mapLoginError({ name: 'NotAuthorizedException', message: 'apa saja' }),
    ).toBe(LOGIN_ERROR_GENERIC);
  });

  it('memetakan plain object {name: UserNotFoundException} ke pesan seragam', () => {
    expect(
      mapLoginError({ name: 'UserNotFoundException', message: 'apa saja' }),
    ).toBe(LOGIN_ERROR_GENERIC);
  });

  it('kedua galat menghasilkan pesan yang benar-benar identik (Req 1.4)', () => {
    const resultNAE = mapLoginError({ name: 'NotAuthorizedException' });
    const resultUNF = mapLoginError({ name: 'UserNotFoundException' });
    expect(resultNAE).toBe(resultUNF);
    expect(resultNAE).toBe('Email atau kata sandi salah');
  });
});

// ---------------------------------------------------------------------------
// 2. Galat kredensial seragam – berdasarkan pesan mentah Cognito
// ---------------------------------------------------------------------------

describe('mapLoginError – galat seragam berdasarkan pesan mentah Cognito', () => {
  it('memetakan string "Incorrect username or password." ke pesan seragam', () => {
    expect(mapLoginError('Incorrect username or password.')).toBe(LOGIN_ERROR_GENERIC);
  });

  it('memetakan string "User does not exist." ke pesan seragam', () => {
    expect(mapLoginError('User does not exist.')).toBe(LOGIN_ERROR_GENERIC);
  });

  it('memetakan string "Username/client id combination not found." ke pesan seragam', () => {
    expect(mapLoginError('Username/client id combination not found.')).toBe(
      LOGIN_ERROR_GENERIC,
    );
  });

  it('memetakan objek {message} Cognito seragam ke pesan seragam', () => {
    expect(mapLoginError({ message: 'User does not exist.' })).toBe(LOGIN_ERROR_GENERIC);
    expect(mapLoginError({ message: 'Incorrect username or password.' })).toBe(
      LOGIN_ERROR_GENERIC,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Galat lain – kembalikan pesan asli atau fallback
// ---------------------------------------------------------------------------

describe('mapLoginError – galat lain: pesan asli atau fallback', () => {
  it('mengembalikan pesan dari Error biasa (bukan galat Cognito)', () => {
    const err = new Error('Koneksi jaringan terputus');
    expect(mapLoginError(err)).toBe('Koneksi jaringan terputus');
  });

  it('mengembalikan string arbitrer yang bukan pesan Cognito seragam', () => {
    expect(mapLoginError('Terjadi timeout saat memuat')).toBe(
      'Terjadi timeout saat memuat',
    );
  });

  it('mengembalikan pesan dari objek dengan name tak dikenal', () => {
    expect(
      mapLoginError({ name: 'NetworkError', message: 'Gagal terhubung ke server' }),
    ).toBe('Gagal terhubung ke server');
  });

  it('mengembalikan fallback bila objek tidak memiliki message', () => {
    expect(mapLoginError({ code: 'UNKNOWN' })).toBe(LOGIN_ERROR_FALLBACK);
  });

  it('mengembalikan fallback bila error adalah null', () => {
    expect(mapLoginError(null)).toBe(LOGIN_ERROR_FALLBACK);
  });

  it('mengembalikan fallback bila error adalah undefined', () => {
    expect(mapLoginError(undefined)).toBe(LOGIN_ERROR_FALLBACK);
  });

  it('mengembalikan fallback bila error adalah angka', () => {
    expect(mapLoginError(404)).toBe(LOGIN_ERROR_FALLBACK);
  });

  it('mengembalikan fallback bila error adalah boolean', () => {
    expect(mapLoginError(false)).toBe(LOGIN_ERROR_FALLBACK);
  });
});

// ---------------------------------------------------------------------------
// 4. LOGIN_ERROR_VOCABULARY – kosakata I18n untuk Authenticator
// ---------------------------------------------------------------------------

describe('LOGIN_ERROR_VOCABULARY', () => {
  it('memetakan semua pesan mentah Cognito ke pesan seragam', () => {
    expect(LOGIN_ERROR_VOCABULARY['Incorrect username or password.']).toBe(
      LOGIN_ERROR_GENERIC,
    );
    expect(LOGIN_ERROR_VOCABULARY['User does not exist.']).toBe(LOGIN_ERROR_GENERIC);
    expect(LOGIN_ERROR_VOCABULARY['Username/client id combination not found.']).toBe(
      LOGIN_ERROR_GENERIC,
    );
  });

  it('tidak memuat kunci yang dipetakan ke nilai selain pesan seragam', () => {
    for (const value of Object.values(LOGIN_ERROR_VOCABULARY)) {
      expect(value).toBe(LOGIN_ERROR_GENERIC);
    }
  });
});
