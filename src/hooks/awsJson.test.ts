// @vitest-environment jsdom
/**
 * Penjaga format kirim untuk skalar `AWSJSON`.
 *
 * Skema memakai `a.json()` untuk argumen custom mutation, yang dipetakan ke
 * skalar GraphQL `AWSJSON`. AppSync mensyaratkan nilainya berupa STRING JSON;
 * mengirim objek biasa ditolak dengan "Variable 'input' has an invalid value"
 * dan sempat melumpuhkan seluruh mutation ledger, mutation AI, serta
 * `bootstrapUser` di lingkungan terdeploy.
 *
 * Tipe TypeScript tidak dapat menangkapnya (tipe `a.json()` permisif) dan uji
 * lain tidak menangkapnya karena klien dimock tanpa memeriksa bentuk argumen.
 * Uji ini memeriksa bentuk argumen itu secara eksplisit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';

const calls: { name: string; args: { input: unknown } }[] = [];

function record(name: string) {
  return vi.fn(async (args: { input: unknown }) => {
    calls.push({ name, args });
    return { data: JSON.stringify({ ok: true, data: { id: 'w1' } }), errors: undefined };
  });
}

vi.mock('../app/amplify', () => ({
  loadAmplifyOutputs: () => ({ version: '1' }),
  configureAmplify: () => true,
}));

vi.mock('../app/dataClient', () => ({
  getDataClient: () => ({
    models: {},
    mutations: {
      createWallet: record('createWallet'),
      saveTransaction: record('saveTransaction'),
      parseNaturalInput: record('parseNaturalInput'),
    },
  }),
}));

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

import { fromAwsJson, toAwsJson } from '../app/awsJson';
import { useCreateWallet, useSaveTransaction } from './useLedgerMutations';
import { useParseNaturalInput } from './useAiMutations';

beforeEach(() => {
  calls.length = 0;
});

describe('toAwsJson / fromAwsJson', () => {
  it('toAwsJson selalu menghasilkan string', () => {
    expect(typeof toAwsJson({ a: 1 })).toBe('string');
    expect(typeof toAwsJson(null)).toBe('string');
    expect(typeof toAwsJson(undefined)).toBe('string');
  });

  it('null dan undefined menjadi objek kosong, bukan "null"', () => {
    expect(toAwsJson(null)).toBe('{}');
    expect(toAwsJson(undefined)).toBe('{}');
  });

  it('fromAwsJson mengurai string JSON', () => {
    expect(fromAwsJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('fromAwsJson meneruskan nilai yang sudah terurai', () => {
    const obj = { a: 1 };
    expect(fromAwsJson(obj)).toBe(obj);
  });

  it('fromAwsJson tidak melempar pada string yang bukan JSON', () => {
    expect(() => fromAwsJson('bukan json')).not.toThrow();
  });

  it('pulang-pergi mempertahankan nilai', () => {
    const payload = { name: 'Tunai', initialBalance: 1500000, nested: { a: [1, 2] } };
    expect(fromAwsJson(toAwsJson(payload))).toEqual(payload);
  });
});

describe('mutation ledger mengirim AWSJSON sebagai string', () => {
  it('useCreateWallet mengirim input berupa string JSON', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useCreateWallet(), { wrapper: makeWrapper(qc) });

    await result.current.mutateAsync({ name: 'Tunai', initialBalance: 1500000 });

    await waitFor(() => expect(calls).toHaveLength(1));
    const sent = calls[0]!.args.input;
    expect(typeof sent).toBe('string');
    expect(JSON.parse(sent as string)).toEqual({ name: 'Tunai', initialBalance: 1500000 });
  });

  it('useSaveTransaction mengirim input berupa string JSON', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useSaveTransaction(), { wrapper: makeWrapper(qc) });

    await result.current.mutateAsync({ amount: 25000 });

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(typeof calls[0]!.args.input).toBe('string');
  });

  it('amplop hasil diurai dari string JSON', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useCreateWallet(), { wrapper: makeWrapper(qc) });

    const out = await result.current.mutateAsync({ name: 'Bank', initialBalance: 0 });

    expect(out).toEqual({ ok: true, data: { id: 'w1' } });
  });
});

describe('mutation AI mengirim AWSJSON sebagai string', () => {
  it('useParseNaturalInput mengirim input berupa string JSON', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useParseNaturalInput(), { wrapper: makeWrapper(qc) });

    await result.current.mutateAsync({ text: 'kopi 25rb' });

    await waitFor(() => expect(calls).toHaveLength(1));
    const sent = calls[0]!.args.input;
    expect(typeof sent).toBe('string');
    expect(JSON.parse(sent as string)).toEqual({ text: 'kopi 25rb' });
  });
});