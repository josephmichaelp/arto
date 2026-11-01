/**
 * AssistantPage — Halaman Asisten Keuangan AI (Tugas 12.11).
 *
 * Chat bergaya gelembung: riwayat pesan di atas, input di bawah.
 * Jumlah dalam jawaban AI ditampilkan dengan format Rupiah ("Rp 1.000.000").
 *
 * Design System: LargeTitle, SoftCard, GlassBar, Skeleton.
 * Tanpa QuickAddFab.
 *
 * Requirements: 12.1, 12.5, 12.6, 16.3, 15.7, 17.8, 17.9, 17.10
 */

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { GlassBar } from '../components/GlassBar';
import { LargeTitle } from '../components/LargeTitle';
import { Skeleton } from '../components/Skeleton';
import { SoftCard } from '../components/SoftCard';
import { useAskAssistant } from '../hooks';

// ---------------------------------------------------------------------------
// Tipe pesan
// ---------------------------------------------------------------------------

type MessageRole = 'user' | 'assistant' | 'error';

interface Message {
  id: string;
  role: MessageRole;
  text: string;
}

// ---------------------------------------------------------------------------
// Konstanta teks
// ---------------------------------------------------------------------------

const DISCLAIMER =
  'Asisten memberikan informasi umum, bukan nasihat keuangan profesional.';

const MSG_RATE_LIMITED =
  'Batas penggunaan AI tercapai. Coba lagi satu jam lagi.';

const MSG_EMPTY_STATE = 'Tanyakan sesuatu tentang keuangan Anda';

const MSG_THINKING = 'Sedang berpikir…';

const ABORT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helper: deteksi kode RATE_LIMITED pada error
// ---------------------------------------------------------------------------

function isRateLimited(err: Error): boolean {
  // Error message dari Lambda mengandung "RATE_LIMITED"
  return err.message.includes('RATE_LIMITED');
}

// ---------------------------------------------------------------------------
// Helper: format angka ke Rupiah di dalam teks (Req 2.7)
//
// Menggantikan pola angka bulat >= 1000 dalam teks jawaban AI menjadi
// format "Rp X.XXX.XXX" agar konsisten dengan Design System.
// ---------------------------------------------------------------------------

function formatRupiahInline(value: number): string {
  return 'Rp ' + value.toLocaleString('id-ID');
}

function formatAnswerText(text: string): string {
  // Ganti semua pola "Rp\s*<angka>" atau angka bulat >= 1000 mandiri menjadi
  // format standar Rupiah Indonesia (titik sebagai pemisah ribuan).
  return text.replace(/\bRp\.?\s*([\d.,]+)/gi, (_match, digits) => {
    const clean = digits.replace(/[.,]/g, '');
    const num = parseInt(clean, 10);
    if (isNaN(num)) return _match;
    return formatRupiahInline(num);
  });
}

// ---------------------------------------------------------------------------
// Komponen: satu gelembung pesan
// ---------------------------------------------------------------------------

interface BubbleProps {
  message: Message;
}

function MessageBubble({ message }: BubbleProps) {
  const isUser = message.role === 'user';
  const isError = message.role === 'error';

  const bubbleStyle: React.CSSProperties = {
    maxWidth: '80%',
    alignSelf: isUser ? 'flex-end' : 'flex-start',
  };

  const cardStyle: React.CSSProperties = {
    padding: '10px 14px',
    backgroundColor: isUser
      ? 'var(--color-brand-blue, #005DAC)'
      : isError
        ? 'var(--color-error-surface, #fff0f0)'
        : undefined,
    color: isUser
      ? '#ffffff'
      : isError
        ? 'var(--color-error, #c0392b)'
        : 'var(--color-ink, #1f2430)',
    borderRadius: isUser
      ? '18px 18px 4px 18px'
      : '18px 18px 18px 4px',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  };

  const textStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 'var(--font-size-body, 16px)',
    lineHeight: 1.55,
  };

  return (
    <div style={bubbleStyle} aria-label={isUser ? 'Pertanyaan Anda' : isError ? 'Galat' : 'Jawaban asisten'}>
      <SoftCard noPadding style={cardStyle}>
        <p style={textStyle}>{isUser ? message.text : formatAnswerText(message.text)}</p>
      </SoftCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Halaman utama
// ---------------------------------------------------------------------------

export function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { mutate: askAssistant, isPending } = useAskAssistant();

  // Gulir ke bawah setiap kali pesan bertambah atau berubah
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isPending]);

  // Bersihkan timer abort saat unmount
  useEffect(() => {
    return () => {
      if (abortRef.current !== null) clearTimeout(abortRef.current);
    };
  }, []);

  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const question = inputText.trim();
      if (!question || isPending) return;

      // Tambah pesan pengguna ke riwayat
      const userMsg: Message = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: question,
      };
      addMessage(userMsg);
      setInputText('');

      // Timeout AbortController 30 detik — sinyal tidak diteruskan ke hook
      // (hook TanStack Query tidak menerima signal), tetapi kita tambah
      // pesan timeout bila jawaban belum tiba setelah batas waktu.
      let timedOut = false;
      if (abortRef.current !== null) clearTimeout(abortRef.current);
      abortRef.current = setTimeout(() => {
        timedOut = true;
        addMessage({
          id: `e-timeout-${Date.now()}`,
          role: 'error',
          text: 'Permintaan melebihi batas waktu 30 detik. Periksa koneksi dan coba lagi.',
        });
      }, ABORT_TIMEOUT_MS);

      askAssistant(
        { question },
        {
          onSuccess: (data) => {
            if (abortRef.current !== null) {
              clearTimeout(abortRef.current);
              abortRef.current = null;
            }
            if (timedOut) return; // Jawaban tiba terlambat, abaikan
            addMessage({
              id: `a-${Date.now()}`,
              role: 'assistant',
              text: data.text,
            });
          },
          onError: (err: Error) => {
            if (abortRef.current !== null) {
              clearTimeout(abortRef.current);
              abortRef.current = null;
            }
            if (timedOut) return;
            const errorText = isRateLimited(err)
              ? MSG_RATE_LIMITED
              : err.message || 'Terjadi kesalahan. Coba lagi beberapa saat.';
            addMessage({
              id: `e-${Date.now()}`,
              role: 'error',
              text: errorText,
            });
          },
        },
      );
    },
    [inputText, isPending, askAssistant, addMessage],
  );

  // Tekan Enter tanpa Shift = kirim
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Ambil pesan error terakhir untuk tombol "Coba lagi"
  const lastMsg = messages[messages.length - 1];
  const lastError =
    messages.length > 0 && lastMsg !== undefined && lastMsg.role === 'error'
      ? lastMsg
      : null;

  // Pertanyaan terakhir yang dikirim pengguna (untuk retry)
  const lastUserQuestion = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg !== undefined && msg.role === 'user') return msg.text;
    }
    return '';
  })();

  const handleRetry = useCallback(() => {
    if (!lastUserQuestion || isPending) return;
    setInputText(lastUserQuestion);
    // Hapus pesan error terakhir agar tidak menumpuk
    setMessages((prev) =>
      prev[prev.length - 1]?.role === 'error' ? prev.slice(0, -1) : prev,
    );
  }, [lastUserQuestion, isPending]);

  const isEmpty = messages.length === 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      {/* Judul halaman */}
      <LargeTitle title="Asisten Keuangan" compact="Asisten" />

      {/* Pernyataan disclaimer */}
      <p
        style={{
          margin: '0 16px 8px',
          fontSize: 'var(--font-size-caption, 13px)',
          color: 'var(--color-ink-muted, #6b7280)',
          textAlign: 'center',
          lineHeight: 1.4,
        }}
      >
        {DISCLAIMER}
      </p>

      {/* Area riwayat pesan */}
      <div
        ref={listRef}
        aria-label="Riwayat percakapan"
        aria-live="polite"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Keadaan kosong */}
        {isEmpty && !isPending && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 24px',
              textAlign: 'center',
              color: 'var(--color-ink-muted, #6b7280)',
            }}
          >
            <div>
              <span
                aria-hidden="true"
                style={{ fontSize: 48, lineHeight: 1, display: 'block', marginBottom: 16 }}
              >
                💬
              </span>
              <p
                style={{
                  margin: 0,
                  fontSize: 'var(--font-size-body, 16px)',
                  fontWeight: 500,
                }}
              >
                {MSG_EMPTY_STATE}
              </p>
            </div>
          </div>
        )}

        {/* Gelembung pesan */}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Indikator "Sedang berpikir..." */}
        {isPending && (
          <div
            style={{
              alignSelf: 'flex-start',
              maxWidth: '60%',
            }}
            aria-live="assertive"
            aria-label={MSG_THINKING}
          >
            <SoftCard
              noPadding
              style={{
                padding: '10px 14px',
                borderRadius: '18px 18px 18px 4px',
              }}
            >
              <Skeleton
                width="100%"
                height={16}
                lines={2}
                label={MSG_THINKING}
              />
              <p
                style={{
                  margin: '8px 0 0',
                  fontSize: 'var(--font-size-caption, 13px)',
                  color: 'var(--color-ink-muted, #6b7280)',
                }}
              >
                {MSG_THINKING}
              </p>
            </SoftCard>
          </div>
        )}

        {/* Tombol "Coba lagi" setelah error */}
        {lastError && !isPending && lastUserQuestion && (
          <div style={{ alignSelf: 'flex-start' }}>
            <button
              type="button"
              onClick={handleRetry}
              style={{
                padding: '8px 16px',
                fontSize: 'var(--font-size-caption, 13px)',
                color: 'var(--color-brand-blue, #005DAC)',
                background: 'rgba(0,93,172,0.08)',
                border: '1px solid rgba(0,93,172,0.2)',
                borderRadius: 20,
                cursor: 'pointer',
              }}
            >
              Coba lagi
            </button>
          </div>
        )}
      </div>

      {/* Kolom input menempel di atas GlassBar bawah */}
      <GlassBar position="bottom" as="div">
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            padding: '8px 12px',
          }}
        >
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              // Tinggi textarea menyesuaikan konten (maks 5 baris)
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ketik pertanyaan Anda…"
            aria-label="Ketik pertanyaan kepada asisten keuangan"
            disabled={isPending}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              overflow: 'hidden',
              padding: '10px 14px',
              borderRadius: 22,
              border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
              fontSize: 'var(--font-size-body, 16px)',
              color: 'var(--color-ink, #1f2430)',
              background: 'var(--color-surface, #ffffff)',
              lineHeight: 1.4,
              outline: 'none',
              minHeight: 42,
            }}
          />
          <button
            type="submit"
            disabled={isPending || !inputText.trim()}
            aria-label="Kirim pertanyaan"
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              backgroundColor:
                isPending || !inputText.trim()
                  ? 'var(--color-border, rgba(0,0,0,0.12))'
                  : 'var(--color-brand-blue, #005DAC)',
              color: '#ffffff',
              border: 'none',
              cursor: isPending || !inputText.trim() ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 18,
              transition: 'background-color 150ms',
            }}
          >
            ↑
          </button>
        </form>
      </GlassBar>
    </div>
  );
}

export default AssistantPage;
