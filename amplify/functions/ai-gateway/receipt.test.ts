import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Category } from 'shared/domain';
import {
  MAX_RECEIPT_BYTES,
  ReceiptValidationError,
  assertKeyBelongsToSub,
  buildPresignedPost,
  buildReceiptKey,
  createReceiptUpload,
  imageFormatFromContentType,
  parseReceiptModelOutput,
  receiptPrefixFor,
  scanReceipt,
  type AwsCredentials,
} from './receipt';

/**
 * Uji operasi struk `ai-gateway` (Requirement 11.1-11.5).
 *
 * Seluruh dependensi AWS disuntik (kredensial tetap, klien S3 palsu, dan
 * pemanggil Converse palsu) sehingga uji berjalan tanpa jaringan.
 */

const CREDS: AwsCredentials = {
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secretExampleKey',
  sessionToken: 'session-token-abc',
};

const CATEGORIES: Category[] = [
  { id: 'cat-makan', name: 'Makan', type: 'EXPENSE' },
  { id: 'cat-transport', name: 'Transport', type: 'EXPENSE' },
];

const TODAY = '2024-03-10';

describe('kunci dan awalan struk', () => {
  it('membentuk awalan dan kunci per Pengguna', () => {
    expect(receiptPrefixFor('user-1')).toBe('receipts/user-1/');
    expect(buildReceiptKey('user-1', 'uuid-9')).toBe('receipts/user-1/uuid-9');
  });

  it('menolak identitas kosong', () => {
    expect(() => receiptPrefixFor('  ')).toThrow(ReceiptValidationError);
  });

  it('menerima kunci milik Pengguna dan menolak milik Pengguna lain', () => {
    expect(() => assertKeyBelongsToSub('receipts/user-1/abc', 'user-1')).not.toThrow();
    expect(() => assertKeyBelongsToSub('receipts/user-2/abc', 'user-1')).toThrow(
      ReceiptValidationError,
    );
  });

  it('menolak path traversal dan kunci bersarang', () => {
    expect(() => assertKeyBelongsToSub('receipts/user-1/../user-2/x', 'user-1')).toThrow(
      ReceiptValidationError,
    );
    expect(() => assertKeyBelongsToSub('receipts/user-1/sub/x', 'user-1')).toThrow(
      ReceiptValidationError,
    );
  });
});

describe('buildPresignedPost', () => {
  const base = {
    sub: 'user-1',
    contentType: 'image/png',
    size: 1024,
    bucket: 'arto-bucket',
    region: 'ap-southeast-1',
    credentials: CREDS,
    now: new Date('2024-03-10T08:30:00Z'),
    uuid: 'uuid-123',
  };

  it('menolak tipe atau ukuran tak valid lewat validateUpload', () => {
    expect(() => buildPresignedPost({ ...base, contentType: 'image/gif' })).toThrow(
      ReceiptValidationError,
    );
    expect(() => buildPresignedPost({ ...base, size: MAX_RECEIPT_BYTES + 1 })).toThrow(
      ReceiptValidationError,
    );
    expect(() => buildPresignedPost({ ...base, size: 0 })).toThrow(ReceiptValidationError);
  });

  it('mengunci key, Content-Type, dan content-length-range pada kebijakan', () => {
    const post = buildPresignedPost(base);
    expect(post.key).toBe('receipts/user-1/uuid-123');
    expect(post.url).toBe('https://arto-bucket.s3.ap-southeast-1.amazonaws.com');
    expect(post.fields['Content-Type']).toBe('image/png');
    expect(post.fields['x-amz-algorithm']).toBe('AWS4-HMAC-SHA256');
    expect(post.fields['x-amz-date']).toBe('20240310T083000Z');
    expect(post.fields['x-amz-credential']).toBe(
      'AKIAEXAMPLE/20240310/ap-southeast-1/s3/aws4_request',
    );
    expect(post.fields['x-amz-security-token']).toBe(CREDS.sessionToken);

    const policy = JSON.parse(Buffer.from(post.fields.policy!, 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual(['eq', '$key', 'receipts/user-1/uuid-123']);
    expect(policy.conditions).toContainEqual(['eq', '$Content-Type', 'image/png']);
    expect(policy.conditions).toContainEqual(['content-length-range', 1, MAX_RECEIPT_BYTES]);
    expect(policy.conditions).toContainEqual({ bucket: 'arto-bucket' });
  });

  it('menandatangani kebijakan dengan SigV4 secara deterministik', () => {
    const post = buildPresignedPost(base);
    const kDate = createHmac('sha256', `AWS4${CREDS.secretAccessKey}`)
      .update('20240310')
      .digest();
    const kRegion = createHmac('sha256', kDate).update('ap-southeast-1').digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const expected = createHmac('sha256', kSigning).update(post.fields.policy!).digest('hex');
    expect(post.fields['x-amz-signature']).toBe(expected);
  });

  it('menghilangkan token sesi bila tidak ada', () => {
    const post = buildPresignedPost({
      ...base,
      credentials: { accessKeyId: CREDS.accessKeyId, secretAccessKey: CREDS.secretAccessKey },
    });
    expect(post.fields['x-amz-security-token']).toBeUndefined();
  });
});

describe('createReceiptUpload', () => {
  const fakeS3 = {
    send: async () => ({}),
    config: {
      region: () => Promise.resolve('ap-southeast-1'),
      credentials: () => Promise.resolve(CREDS),
    },
  } as never;

  it('membuat presigned POST dengan dependensi tersuntik', async () => {
    const post = await createReceiptUpload(
      { sub: 'user-1', contentType: 'image/jpeg', size: 2048 },
      {
        s3: fakeS3,
        bucket: 'arto-bucket',
        now: () => new Date('2024-03-10T08:30:00Z'),
        uuid: () => 'uuid-abc',
      },
    );
    expect(post.key).toBe('receipts/user-1/uuid-abc');
    expect(post.fields['Content-Type']).toBe('image/jpeg');
  });

  it('menolak unggahan tak valid sebelum menyentuh S3', async () => {
    await expect(
      createReceiptUpload(
        { sub: 'user-1', contentType: 'application/pdf', size: 100 },
        { s3: fakeS3, bucket: 'arto-bucket' },
      ),
    ).rejects.toBeInstanceOf(ReceiptValidationError);
  });
});

describe('imageFormatFromContentType', () => {
  it('memetakan JPEG dan PNG', () => {
    expect(imageFormatFromContentType('image/jpeg')).toBe('jpeg');
    expect(imageFormatFromContentType('image/png')).toBe('png');
  });

  it('menolak format lain', () => {
    expect(() => imageFormatFromContentType('image/gif')).toThrow(ReceiptValidationError);
    expect(() => imageFormatFromContentType(undefined)).toThrow(ReceiptValidationError);
  });
});

describe('parseReceiptModelOutput', () => {
  const ctx = { categories: CATEGORIES, todayWib: TODAY };

  it('menghasilkan ok untuk JSON lengkap dan valid', () => {
    const out = parseReceiptModelOutput(
      'Berikut hasilnya: {"type":"EXPENSE","amount":35000,"date":"2024-03-01","merchant":"Toko","categoryId":"cat-makan"}',
      ctx,
    );
    expect(out.status).toBe('ok');
    if (out.status === 'ok') {
      expect(out.amount).toBe(35000);
      expect(out.categoryId).toBe('cat-makan');
      expect(out.merchant).toBe('Toko');
    }
  });

  it('menghasilkan needs_amount untuk JSON rusak', () => {
    expect(parseReceiptModelOutput('bukan json', ctx).status).toBe('needs_amount');
  });

  it('menghasilkan needs_amount saat total tak terbaca', () => {
    const out = parseReceiptModelOutput(
      '{"type":"EXPENSE","date":"2024-03-01","categoryId":"cat-makan"}',
      ctx,
    );
    expect(out.status).toBe('needs_amount');
  });

  it('menolak categoryId di luar daftar Pengguna', () => {
    const out = parseReceiptModelOutput(
      '{"type":"EXPENSE","amount":1000,"categoryId":"cat-asing"}',
      ctx,
    );
    expect(out.status).toBe('needs_amount');
  });
});

describe('scanReceipt', () => {
  function fakeS3WithImage(contentType: string) {
    return {
      send: async (command: unknown) => {
        expect(command).toBeInstanceOf(GetObjectCommand);
        return {
          ContentType: contentType,
          Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
        };
      },
      config: { region: () => Promise.resolve('ap-southeast-1'), credentials: () => Promise.resolve(CREDS) },
    } as never;
  }

  const config = {
    bedrockRegion: 'ap-southeast-3',
    modelCandidates: [{ modelId: 'amazon.nova-lite-v1:0', region: 'ap-southeast-3' }],
    allowCrossRegion: true,
    aiRateLimit: 30,
  };

  it('mengambil gambar, memanggil model, lalu memvalidasi hasil', async () => {
    let sawImage = false;
    const out = await scanReceipt(
      { sub: 'user-1', key: 'receipts/user-1/uuid-1', categories: CATEGORIES, todayWib: TODAY },
      {
        s3: fakeS3WithImage('image/jpeg'),
        bucket: 'arto-bucket',
        config,
        invoke: async ({ messages }) => {
          sawImage = messages[0]!.content!.some((b) => 'image' in b);
          return '{"type":"EXPENSE","amount":52000,"date":"2024-03-05","categoryId":"cat-transport"}';
        },
      },
    );
    expect(sawImage).toBe(true);
    expect(out.status).toBe('ok');
    if (out.status === 'ok') {
      expect(out.amount).toBe(52000);
      expect(out.categoryId).toBe('cat-transport');
    }
  });

  it('menolak kunci milik Pengguna lain tanpa memanggil S3', async () => {
    let called = false;
    await expect(
      scanReceipt(
        { sub: 'user-1', key: 'receipts/user-2/uuid-1', categories: CATEGORIES, todayWib: TODAY },
        {
          s3: { send: async () => { called = true; return {}; }, config: {} } as never,
          bucket: 'arto-bucket',
          config,
        },
      ),
    ).rejects.toBeInstanceOf(ReceiptValidationError);
    expect(called).toBe(false);
  });

  it('menghasilkan needs_amount saat model gagal membaca total', async () => {
    const out = await scanReceipt(
      { sub: 'user-1', key: 'receipts/user-1/uuid-1', categories: CATEGORIES, todayWib: TODAY },
      {
        s3: fakeS3WithImage('image/png'),
        bucket: 'arto-bucket',
        config,
        invoke: async () => '{"type":"EXPENSE","date":"2024-03-05","categoryId":"cat-makan"}',
      },
    );
    expect(out.status).toBe('needs_amount');
  });
});
