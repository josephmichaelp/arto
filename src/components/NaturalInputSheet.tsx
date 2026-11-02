/**
 * NaturalInputSheet — BottomSheet untuk input transaksi cepat (Tugas 12.10).
 *
 * Fase 1 (tab "Tulis"): Input bahasa alami
 * - Textarea "Contoh: makan siang 35rb"
 * - Memanggil useParseNaturalInput lewat hook AI
 * - Jika result.needsAmount: tampilkan input nominal tambahan (Indonesia)
 * - Tampilkan pratinjau (jenis/nominal/tanggal/kategori) dengan kemampuan edit
 * - Submit akhir memanggil useSaveTransaction
 *
 * Fase 2 (tab "Pindai Struk"): Pemindaian struk
 * - Tombol "Pindai Struk" membuka file picker (accept image/jpeg,image/png)
 * - Validasi tipe & ukuran file
 * - Memanggil useCreateReceiptUpload untuk presigned URL
 * - PUT ke S3
 * - Memanggil useScanReceipt
 * - Tampilkan pratinjau dan izinkan pengeditan sebelum menyimpan
 *
 * Penanganan galat: RATE_LIMITED → "Batas penggunaan AI tercapai",
 * galat lain → pesan Indonesia.
 *
 * Requirements: 10.1–10.7, 11.1–11.5
 */

import { useEffect, useRef, useState } from 'react';
import { AmountInput } from './AmountInput';
import { AmountDisplay } from './AmountDisplay';
import { BottomSheet } from './BottomSheet';
import { SoftCard } from './SoftCard';
import {
  useCategories,
  useWallets,
  useParseNaturalInput,
  useCreateReceiptUpload,
  useScanReceipt,
  useSaveTransaction,
} from '../hooks';
import type {
  CategoryItem,
  NaturalInputPreview,
  ReceiptPreview,
  WalletItem,
} from '../hooks';

// ---------------------------------------------------------------------------
// Tipe & konstanta
// ---------------------------------------------------------------------------

type Tab = 'natural' | 'receipt';
type NlStep = 'input' | 'preview';
type ReceiptStep = 'pick' | 'processing' | 'preview';

/** Ukuran file maksimal: 10 MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

interface PreviewForm {
  type: 'EXPENSE' | 'INCOME';
  amount: string; // string agar terkontrol oleh input
  date: string; // YYYY-MM-DD
  categoryId: string;
  walletId: string;
  note: string;
}

function todayWib(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}

function emptyForm(): PreviewForm {
  return {
    type: 'EXPENSE',
    amount: '',
    date: todayWib(),
    categoryId: '',
    walletId: '',
    note: '',
  };
}

/**
 * Mengubah Error dari AI Gateway menjadi pesan Indonesia yang ramah.
 * RATE_LIMITED ditangani secara khusus.
 */
function formatAiError(error: Error): string {
  const msg = error.message ?? '';
  if (
    msg.includes('RATE_LIMITED') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('ratelimit')
  ) {
    return 'Batas penggunaan AI tercapai. Coba lagi nanti.';
  }
  if (msg) return msg;
  return 'Terjadi kesalahan. Silakan coba lagi.';
}

// ---------------------------------------------------------------------------
// Gaya berulang
// ---------------------------------------------------------------------------

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  border: '1.5px solid var(--color-border, rgba(0,0,0,0.15))',
  borderRadius: 12,
  fontSize: 'var(--font-size-body, 16px)',
  background: 'var(--color-card, #fff)',
  color: 'var(--color-ink, #1f2430)',
  minHeight: 44,
};

const BTN_PRIMARY_BASE: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  padding: '12px 16px',
  background: 'var(--color-brand-blue, #005DAC)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-card, 20px)',
  fontWeight: 700,
  fontSize: 'var(--font-size-body, 16px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const BTN_GHOST_BASE: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '10px 16px',
  border: 'none',
  background: 'none',
  color: 'var(--color-ink-muted, #6b7280)',
  fontSize: 'var(--font-size-caption, 14px)',
  fontWeight: 500,
  cursor: 'pointer',
  borderRadius: 12,
};

// ---------------------------------------------------------------------------
// Sub-komponen
// ---------------------------------------------------------------------------

function FormField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          marginBottom: 6,
          fontSize: 'var(--font-size-caption, 13px)',
          fontWeight: 600,
          color: 'var(--color-ink, #1f2430)',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorMsg({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <p
      role="alert"
      style={{
        margin: '4px 0 8px',
        fontSize: 'var(--font-size-caption, 13px)',
        color: 'var(--color-expense, #c0392b)',
        ...style,
      }}
    >
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Sub-komponen: form pratinjau yang dapat diedit
// ---------------------------------------------------------------------------

interface EditablePreviewFormProps {
  form: PreviewForm;
  onChange: (updater: (prev: PreviewForm) => PreviewForm) => void;
  categories: CategoryItem[];
  wallets: WalletItem[];
}

function EditablePreviewForm({
  form,
  onChange,
  categories,
  wallets,
}: EditablePreviewFormProps) {
  const set = <K extends keyof PreviewForm>(key: K, value: PreviewForm[K]) =>
    onChange((f) => ({ ...f, [key]: value }));

  return (
    <>
      <FormField id="preview-type" label="Jenis">
        <select
          id="preview-type"
          value={form.type}
          onChange={(e) => set('type', e.target.value as 'EXPENSE' | 'INCOME')}
          style={INPUT_STYLE}
        >
          <option value="EXPENSE">Pengeluaran</option>
          <option value="INCOME">Pemasukan</option>
        </select>
      </FormField>

      <FormField id="preview-amount" label="Nominal (Rp)">
        {form.amount ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AmountInput
              id="preview-amount"              placeholder="Contoh: 35000"
              value={form.amount}
              onChange={(digits: string) => set('amount', digits)}
              style={{ ...INPUT_STYLE, flex: 1 }}
            />
            <AmountDisplay
              amount={parseInt(form.amount, 10) || 0}
              variant={form.type === 'INCOME' ? 'income' : 'expense'}
              style={{
                fontWeight: 700,
                fontSize: 'var(--font-size-body, 16px)',
                flexShrink: 0,
              }}
            />
          </div>
        ) : (
          <AmountInput
            id="preview-amount"            placeholder="Contoh: 35000"
            value={form.amount}
            onChange={(digits: string) => set('amount', digits)}
            style={INPUT_STYLE}
          />
        )}
      </FormField>

      <FormField id="preview-date" label="Tanggal">
        <input
          id="preview-date"
          type="date"
          value={form.date}
          onChange={(e) => set('date', e.target.value)}
          style={INPUT_STYLE}
        />
      </FormField>

      <FormField id="preview-category" label="Kategori">
        <select
          id="preview-category"
          value={form.categoryId}
          onChange={(e) => set('categoryId', e.target.value)}
          style={INPUT_STYLE}
        >
          <option value="">— Tanpa kategori —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField id="preview-wallet" label="Dompet">
        <select
          id="preview-wallet"
          value={form.walletId}
          onChange={(e) => set('walletId', e.target.value)}
          style={INPUT_STYLE}
        >
          <option value="">— Pilih dompet —</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField id="preview-note" label="Catatan (opsional)">
        <textarea
          id="preview-note"
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
          placeholder="Tambahkan catatan…"
          rows={2}
          style={{ ...INPUT_STYLE, resize: 'vertical' }}
        />
      </FormField>
    </>
  );
}

// ---------------------------------------------------------------------------
// Props komponen utama
// ---------------------------------------------------------------------------

export interface NaturalInputSheetProps {
  /** Apakah sheet terbuka. */
  open: boolean;
  /** Dipanggil saat sheet harus ditutup. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Komponen utama: NaturalInputSheet
// ---------------------------------------------------------------------------

export function NaturalInputSheet({ open, onClose }: NaturalInputSheetProps) {
  // ---- Data hooks ----
  const { data: categories } = useCategories();
  const { data: wallets } = useWallets();

  // ---- AI & mutation hooks ----
  const parseNl = useParseNaturalInput();
  const createUpload = useCreateReceiptUpload();
  const scanReceiptMutation = useScanReceipt();
  const saveTx = useSaveTransaction();

  // ---- State UI ----
  const [tab, setTab] = useState<Tab>('natural');

  // Phase 1: Natural language
  const [nlText, setNlText] = useState('');
  const [nlStep, setNlStep] = useState<NlStep>('input');
  const [nlError, setNlError] = useState<string | null>(null);
  // Nominal tambahan ketika AI meminta (needsAmount)
  const [nlExtraAmount, setNlExtraAmount] = useState('');

  // Phase 2: Receipt scan
  const [receiptStep, setReceiptStep] = useState<ReceiptStep>('pick');
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Form pratinjau bersama (diisi dari NL atau struk, lalu diedit pengguna)
  const [previewForm, setPreviewForm] = useState<PreviewForm>(emptyForm());
  const [saveError, setSaveError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Reset semua state saat sheet menutup
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open) {
      setTab('natural');
      setNlText('');
      setNlStep('input');
      setNlError(null);
      setNlExtraAmount('');
      setReceiptStep('pick');
      setReceiptError(null);
      setPreviewForm(emptyForm());
      setSaveError(null);
      parseNl.reset();
      createUpload.reset();
      scanReceiptMutation.reset();
      saveTx.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---------------------------------------------------------------------------
  // Helper: isi PreviewForm dari NaturalInputPreview
  // ---------------------------------------------------------------------------

  function applyNlPreview(preview: NaturalInputPreview, overrideAmount?: number): void {
    const resolvedAmount = overrideAmount ?? preview.amount;
    setPreviewForm({
      type: preview.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
      amount: resolvedAmount != null ? String(resolvedAmount) : '',
      date: preview.date ?? todayWib(),
      categoryId: preview.categoryId ?? '',
      walletId: '',
      note: preview.note ?? '',
    });
  }

  function applyReceiptPreview(preview: ReceiptPreview): void {
    setPreviewForm({
      type: 'EXPENSE',
      amount: preview.total != null ? String(preview.total) : '',
      date: preview.date ?? todayWib(),
      categoryId: preview.categoryId ?? '',
      walletId: '',
      note: preview.merchant ?? '',
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Kirim teks ke AI
  // ---------------------------------------------------------------------------

  const handleNlSubmit = async () => {
    const text = nlText.trim();
    if (!text) {
      setNlError('Tulis deskripsi transaksi terlebih dahulu.');
      return;
    }
    setNlError(null);
    try {
      const result = await parseNl.mutateAsync({ text });
      applyNlPreview(result);
      setNlStep('preview');
    } catch (e) {
      setNlError(e instanceof Error ? formatAiError(e) : 'Terjadi kesalahan. Coba lagi.');
    }
  };

  /** Konfirmasi nominal saat AI mengembalikan needsAmount. */
  const handleNlAmountConfirm = () => {
    const amt = parseInt(nlExtraAmount, 10);
    if (!nlExtraAmount || isNaN(amt) || amt <= 0) {
      setNlError('Nominal harus berupa angka bulat lebih dari 0.');
      return;
    }
    setNlError(null);
    setPreviewForm((f) => ({ ...f, amount: String(amt) }));
    setNlExtraAmount('');
  };

  // ---------------------------------------------------------------------------
  // Phase 2: Pilih & proses file struk
  // ---------------------------------------------------------------------------

  const handleReceiptFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    // Reset value agar pemilihan file yang sama bisa diulangi
    e.target.value = '';
    if (!file) return;

    // Validasi tipe MIME
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setReceiptError('Hanya file JPEG atau PNG yang diperbolehkan.');
      return;
    }
    // Validasi ukuran
    if (file.size > MAX_FILE_SIZE) {
      setReceiptError('Ukuran file maksimal 10 MB.');
      return;
    }

    setReceiptError(null);
    setReceiptStep('processing');

    try {
      // Langkah 1: Dapatkan presigned URL
      const uploadData = await createUpload.mutateAsync({
        contentType: file.type,
        fileSize: file.size,
      });

      // Langkah 2: PUT file ke S3
      const putResponse = await fetch(uploadData.url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!putResponse.ok) {
        throw new Error(
          `Gagal mengunggah struk ke server (HTTP ${putResponse.status}).`,
        );
      }

      // Langkah 3: Minta AI pindai struk yang sudah diunggah
      const receiptResult = await scanReceiptMutation.mutateAsync({
        receiptKey: uploadData.key,
      });

      // Langkah 4: Isi form pratinjau dari hasil pindaian
      applyReceiptPreview(receiptResult);
      setReceiptStep('preview');
    } catch (e) {
      setReceiptError(
        e instanceof Error ? formatAiError(e) : 'Gagal memproses struk. Coba lagi.',
      );
      setReceiptStep('pick');
    }
  };

  // ---------------------------------------------------------------------------
  // Simpan Transaksi (dipakai oleh kedua fase)
  // ---------------------------------------------------------------------------

  const handleSave = async (): Promise<void> => {
    const amount = parseInt(previewForm.amount, 10);
    if (!previewForm.amount || isNaN(amount) || amount <= 0) {
      setSaveError('Nominal harus berupa angka bulat lebih dari 0.');
      return;
    }
    if (!previewForm.date || !/^\d{4}-\d{2}-\d{2}$/.test(previewForm.date)) {
      setSaveError('Tanggal tidak valid. Gunakan format YYYY-MM-DD.');
      return;
    }
    if (!previewForm.walletId) {
      setSaveError('Pilih dompet terlebih dahulu.');
      return;
    }
    setSaveError(null);

    try {
      await saveTx.mutateAsync({
        type: previewForm.type,
        amount,
        date: previewForm.date,
        month: previewForm.date.slice(0, 7), // YYYY-MM
        walletId: previewForm.walletId,
        ...(previewForm.categoryId ? { categoryId: previewForm.categoryId } : {}),
        ...(previewForm.note.trim() ? { note: previewForm.note.trim() } : {}),
      });
      onClose();
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : 'Gagal menyimpan transaksi. Coba lagi.',
      );
    }
  };

  // ---------------------------------------------------------------------------
  // Helper: apakah AI membutuhkan nominal dari pengguna?
  // ---------------------------------------------------------------------------

  const nlNeedsAmount =
    nlStep === 'preview' &&
    (parseNl.data?.needsAmount === true) &&
    !previewForm.amount;

  // Kategori yang relevan berdasarkan jenis transaksi yang dipilih
  const filteredCategories = (categories ?? []).filter(
    (c) => c.type === previewForm.type,
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <BottomSheet open={open} onClose={onClose} title="Input Cepat" sheetKey="natural-input">

      {/* ===== Tab switcher ===== */}
      <div
        role="tablist"
        aria-label="Mode input transaksi"
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 20,
          background: 'var(--color-border, rgba(0,0,0,0.07))',
          borderRadius: 'var(--radius-card, 20px)',
          padding: 4,
        }}
      >
        {(['natural', 'receipt'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              if (tab === t) return;
              setTab(t);
              setSaveError(null);
              if (t === 'natural') {
                setReceiptStep('pick');
                setReceiptError(null);
              } else {
                setNlStep('input');
                setNlError(null);
              }
            }}
            style={{
              flex: 1,
              minHeight: 36,
              border: 'none',
              borderRadius: 'calc(var(--radius-card, 20px) - 4px)',
              fontWeight: 600,
              fontSize: 'var(--font-size-caption, 14px)',
              cursor: 'pointer',
              transition: 'background 140ms, color 140ms, box-shadow 140ms',
              background: tab === t ? 'var(--color-card, #fff)' : 'transparent',
              color:
                tab === t
                  ? 'var(--color-brand-blue, #005DAC)'
                  : 'var(--color-ink-muted, #6b7280)',
              boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
            }}
          >
            {t === 'natural' ? '✍️ Tulis' : '📷 Pindai Struk'}
          </button>
        ))}
      </div>

      {/* ============================= */}
      {/* Fase 1: Input Bahasa Alami   */}
      {/* ============================= */}
      {tab === 'natural' && (
        <div>

          {/* Langkah: input teks */}
          {nlStep === 'input' && (
            <>
              <FormField id="nl-text" label="Deskripsikan transaksi Anda">
                <textarea
                  id="nl-text"
                  value={nlText}
                  onChange={(e) => setNlText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      void handleNlSubmit();
                    }
                  }}
                  placeholder="Contoh: makan siang 35rb"
                  rows={3}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  style={{ ...INPUT_STYLE, resize: 'none', lineHeight: 1.5 }}
                />
              </FormField>

              {nlError && <ErrorMsg>{nlError}</ErrorMsg>}

              <button
                type="button"
                onClick={() => void handleNlSubmit()}
                disabled={parseNl.isPending}
                style={{
                  ...BTN_PRIMARY_BASE,
                  marginTop: 4,
                  opacity: parseNl.isPending ? 0.7 : 1,
                  cursor: parseNl.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {parseNl.isPending ? 'Menganalisis…' : 'Analisis'}
              </button>
            </>
          )}

          {/* Langkah: pratinjau + edit */}
          {nlStep === 'preview' && (
            <>
              {/* Ringkasan teks asli */}
              <SoftCard style={{ marginBottom: 16 }}>
                <p
                  style={{
                    margin: '0 0 4px',
                    fontSize: 'var(--font-size-caption, 12px)',
                    fontWeight: 600,
                    color: 'var(--color-ink-muted, #6b7280)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Teks asli
                </p>
                <p
                  style={{
                    margin: 0,
                    fontStyle: 'italic',
                    color: 'var(--color-ink, #1f2430)',
                    fontSize: 'var(--font-size-body, 16px)',
                  }}
                >
                  "{nlText}"
                </p>
              </SoftCard>

              {/* Blok input nominal tambahan (saat AI tidak mendeteksi nominal) */}
              {nlNeedsAmount && (
                <SoftCard
                  style={{
                    marginBottom: 16,
                    border: '1.5px solid var(--color-brand-blue, #005DAC)',
                  }}
                >
                  <p
                    style={{
                      margin: '0 0 12px',
                      fontSize: 'var(--font-size-body, 15px)',
                      color: 'var(--color-ink, #1f2430)',
                    }}
                  >
                    AI tidak mendeteksi nominal. Masukkan nominal transaksi:
                  </p>

                  <FormField id="nl-extra-amount" label="Nominal (Rp)">
                    <AmountInput
                      id="nl-extra-amount"                      placeholder="Contoh: 35000"
                      value={nlExtraAmount}
                      onChange={setNlExtraAmount}
                      style={INPUT_STYLE}
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                    />
                  </FormField>

                  {nlError && <ErrorMsg>{nlError}</ErrorMsg>}

                  <button
                    type="button"
                    onClick={handleNlAmountConfirm}
                    style={{
                      ...BTN_PRIMARY_BASE,
                      marginTop: 4,
                    }}
                  >
                    Konfirmasi Nominal
                  </button>
                </SoftCard>
              )}

              {/* Form pratinjau yang dapat diedit */}
              <p
                style={{
                  margin: '0 0 12px',
                  fontSize: 'var(--font-size-caption, 13px)',
                  fontWeight: 600,
                  color: 'var(--color-ink-muted, #6b7280)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Pratinjau — periksa dan ubah jika perlu
              </p>

              <EditablePreviewForm
                form={previewForm}
                onChange={setPreviewForm}
                categories={filteredCategories}
                wallets={wallets ?? []}
              />

              {saveError && <ErrorMsg>{saveError}</ErrorMsg>}

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saveTx.isPending || nlNeedsAmount}
                style={{
                  ...BTN_PRIMARY_BASE,
                  marginTop: 4,
                  opacity: saveTx.isPending || nlNeedsAmount ? 0.7 : 1,
                  cursor:
                    saveTx.isPending || nlNeedsAmount ? 'not-allowed' : 'pointer',
                }}
              >
                {saveTx.isPending ? 'Menyimpan…' : 'Simpan Transaksi'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setNlStep('input');
                  setNlError(null);
                  setNlExtraAmount('');
                  parseNl.reset();
                  setSaveError(null);
                }}
                style={{ ...BTN_GHOST_BASE, marginTop: 4 }}
              >
                ← Ubah teks
              </button>
            </>
          )}
        </div>
      )}

      {/* ============================= */}
      {/* Fase 2: Pindai Struk          */}
      {/* ============================= */}
      {tab === 'receipt' && (
        <div>

          {/* Langkah: pilih file */}
          {receiptStep === 'pick' && (
            <>
              <p
                style={{
                  textAlign: 'center',
                  fontSize: 'var(--font-size-body, 15px)',
                  color: 'var(--color-ink-muted, #6b7280)',
                  margin: '12px 0 24px',
                  lineHeight: 1.5,
                }}
              >
                Foto struk belanja Anda akan dianalisis secara otomatis oleh AI.
                Pastikan tulisan pada struk terlihat jelas.
              </p>

              {/* Input file tersembunyi */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                style={{ display: 'none' }}
                aria-label="Pilih foto struk"
                onChange={(e) => void handleReceiptFileChange(e)}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{ ...BTN_PRIMARY_BASE }}
              >
                <span aria-hidden="true">📷</span>
                Pindai Struk
              </button>

              {receiptError && (
                <ErrorMsg style={{ marginTop: 12, textAlign: 'center' }}>
                  {receiptError}
                </ErrorMsg>
              )}
            </>
          )}

          {/* Langkah: sedang memproses */}
          {receiptStep === 'processing' && (
            <div
              role="status"
              aria-live="polite"
              style={{
                textAlign: 'center',
                padding: '40px 0',
                color: 'var(--color-ink-muted, #6b7280)',
              }}
            >
              <p style={{ fontSize: 44, margin: '0 0 16px', lineHeight: 1 }} aria-hidden="true">
                ⏳
              </p>
              <p
                style={{
                  fontSize: 'var(--font-size-body, 16px)',
                  fontWeight: 600,
                  margin: '0 0 8px',
                  color: 'var(--color-ink, #1f2430)',
                }}
              >
                Menganalisis struk…
              </p>
              <p style={{ fontSize: 'var(--font-size-caption, 13px)', margin: 0 }}>
                Ini mungkin memerlukan beberapa detik.
              </p>
            </div>
          )}

          {/* Langkah: pratinjau hasil pindaian */}
          {receiptStep === 'preview' && (
            <>
              <p
                style={{
                  margin: '0 0 12px',
                  fontSize: 'var(--font-size-caption, 13px)',
                  fontWeight: 600,
                  color: 'var(--color-ink-muted, #6b7280)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Hasil pindaian — periksa dan ubah jika perlu
              </p>

              <EditablePreviewForm
                form={previewForm}
                onChange={setPreviewForm}
                categories={filteredCategories}
                wallets={wallets ?? []}
              />

              {saveError && <ErrorMsg>{saveError}</ErrorMsg>}

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saveTx.isPending}
                style={{
                  ...BTN_PRIMARY_BASE,
                  marginTop: 4,
                  opacity: saveTx.isPending ? 0.7 : 1,
                  cursor: saveTx.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {saveTx.isPending ? 'Menyimpan…' : 'Simpan Transaksi'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setReceiptStep('pick');
                  setReceiptError(null);
                  createUpload.reset();
                  scanReceiptMutation.reset();
                  setSaveError(null);
                }}
                style={{ ...BTN_GHOST_BASE, marginTop: 4 }}
              >
                ← Pindai struk lain
              </button>
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

export default NaturalInputSheet;
