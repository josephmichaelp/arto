/**
 * ReportPage — Halaman Laporan dan Ekspor (Tugas 12.9).
 *
 * Menampilkan ringkasan keuangan bulanan (pemasukan, pengeluaran, selisih),
 * grafik pengeluaran per kategori (BarChart horizontal), grafik tren harian
 * (LineChart), serta tombol unduh CSV. Semua grafik dimuat secara lazy via
 * `React.lazy`. Hanya menyentuh berkas ini.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 14.1, 14.2, 14.3, 14.4, 14.5,
 *               15.7, 17.1, 17.9, 17.10
 */

import React, { lazy, Suspense, useMemo, useState } from 'react';

import { AmountDisplay } from '../components/AmountDisplay';
import { LargeTitle } from '../components/LargeTitle';
import { Skeleton } from '../components/Skeleton';
import { SoftCard } from '../components/SoftCard';
import { useCategories } from '../hooks/useCategories';
import { useTransactions } from '../hooks/useTransactions';
import {
  byCategory,
  daysInMonth,
  formatRupiah,
  summarize,
  toCsv,
  toJakartaMonth,
  trend,
} from 'shared/domain';
import type { DateRange, ExportRow, Txn } from 'shared/domain';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BULAN_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function formatMonthId(month: string): string {
  const parts = month.split('-');
  const m = Number(parts[1]);
  return `${BULAN_ID[m - 1]} ${parts[0]}`;
}

function addMonths(month: string, n: number): string {
  const parts = month.split('-');
  const year = Number(parts[0]);
  const m = Number(parts[1]);
  const d = new Date(Date.UTC(year, m - 1 + n, 1));
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

function monthDateRange(month: string): DateRange {
  const lastDay = daysInMonth(month);
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

// ---------------------------------------------------------------------------
// Lazy charts (Recharts dimuat React.lazy agar bundle awal lebih ringan)
// ---------------------------------------------------------------------------

interface CategoryChartProps {
  data: { name: string; total: number }[];
}

const CategoryBarChart = lazy(async () => {
  const {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
  } = await import('recharts');

  function CategoryBarChartImpl({ data }: CategoryChartProps) {
    const height = Math.max(160, data.length * 52);
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={130}
            tick={{ fontSize: 12, fill: 'var(--color-ink-muted, #6b7280)' }}
          />
          <Tooltip
            formatter={(value: unknown) => [
              formatRupiah(typeof value === 'number' ? value : 0),
              'Total',
            ]}
            contentStyle={{
              borderRadius: 12,
              border: 'none',
              boxShadow: '0 4px 16px rgba(0,0,0,.12)',
              fontSize: 13,
            }}
          />
          <Bar
            dataKey="total"
            fill="var(--color-brand-blue, #005DAC)"
            radius={[0, 6, 6, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return { default: CategoryBarChartImpl };
});

interface TrendChartProps {
  data: { bucket: string; income: number; expense: number }[];
}

const TrendLineChart = lazy(async () => {
  const {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    ResponsiveContainer,
  } = await import('recharts');

  function TrendLineChartImpl({ data }: TrendChartProps) {
    return (
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
          <XAxis
            dataKey="bucket"
            tick={{ fontSize: 11, fill: 'var(--color-ink-muted, #6b7280)' }}
            interval="preserveStartEnd"
          />
          <YAxis hide />
          <Tooltip
            formatter={(value: unknown, name: unknown) => [
              formatRupiah(typeof value === 'number' ? value : 0),
              name === 'income' ? 'Pemasukan' : 'Pengeluaran',
            ]}
            contentStyle={{
              borderRadius: 12,
              border: 'none',
              boxShadow: '0 4px 16px rgba(0,0,0,.12)',
              fontSize: 13,
            }}
          />
          <Legend
            formatter={(value: string) =>
              value === 'income' ? 'Pemasukan' : 'Pengeluaran'
            }
          />
          <Line
            type="monotone"
            dataKey="income"
            name="income"
            stroke="var(--color-income, #1a7a4a)"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="expense"
            name="expense"
            stroke="var(--color-expense, #c0392b)"
            dot={false}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return { default: TrendLineChartImpl };
});

// ---------------------------------------------------------------------------
// Komponen utama
// ---------------------------------------------------------------------------

export function ReportPage() {
  const currentMonth = useMemo(() => toJakartaMonth(new Date()), []);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const range = useMemo(() => monthDateRange(selectedMonth), [selectedMonth]);

  // Data dari hooks
  const { data: transactions, isPending: txPending } = useTransactions({
    month: selectedMonth,
  });
  const { data: categories, isPending: catPending } = useCategories();

  const isPending = txPending || catPending;

  // Peta categoryId → nama untuk tampilan grafik dan CSV
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    (categories ?? []).forEach((c) => map.set(c.id, c.name ?? c.id));
    return map;
  }, [categories]);

  // Cast TransactionItem[] ke Txn[] domain murni
  const domainTxns: Txn[] = useMemo(
    () =>
      (transactions ?? []).map((t) => ({
        id: t.id,
        type: t.type as Txn['type'],
        amount: t.amount ?? 0,
        date: t.date ?? '',
        categoryId: t.categoryId ?? undefined,
        walletId: t.walletId ?? '',
        note: t.note ?? undefined,
      })),
    [transactions],
  );

  // Hitung ringkasan menggunakan domain murni
  const summary = useMemo(() => summarize(domainTxns, range), [domainTxns, range]);

  // Hitung pengeluaran per kategori
  const categoryData = useMemo(
    () =>
      byCategory(domainTxns, range).map((item) => ({
        name: (categoryMap.get(item.categoryId) ?? item.categoryId) || 'Tanpa Kategori',
        total: item.total,
        categoryId: item.categoryId,
      })),
    [domainTxns, range, categoryMap],
  );

  // Hitung tren harian
  const trendData = useMemo(
    () => trend(domainTxns, range, 'DAY'),
    [domainTxns, range],
  );

  const hasTxns = domainTxns.length > 0;

  // -------------------------------------------------------------------------
  // Navigasi bulan
  // -------------------------------------------------------------------------

  const handlePrevMonth = () => setSelectedMonth((m) => addMonths(m, -1));
  const handleNextMonth = () => {
    const next = addMonths(selectedMonth, 1);
    if (next <= currentMonth) setSelectedMonth(next);
  };
  const isNextDisabled = addMonths(selectedMonth, 1) > currentMonth;

  // -------------------------------------------------------------------------
  // Ekspor CSV
  // -------------------------------------------------------------------------

  const handleDownloadCsv = () => {
    if (!hasTxns) {
      // Tidak ada data untuk diekspor
      return;
    }
    const rows: ExportRow[] = domainTxns.map((t) => ({
      date: t.date,
      type: t.type,
      category: categoryMap.get(t.categoryId ?? '') ?? t.categoryId ?? '',
      wallet: t.walletId,
      amount: t.amount,
      note: t.note ?? '',
    }));

    const csv = toCsv(rows);
    // BOM UTF-8 agar Excel membaca karakter Indonesia dengan benar
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `laporan-arto-${selectedMonth}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* Judul halaman */}
      <LargeTitle title="Laporan" />

      {/* Pemilih bulan */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
          gap: 8,
        }}
      >
        <button
          type="button"
          aria-label="Bulan sebelumnya"
          onClick={handlePrevMonth}
          style={navButtonStyle}
        >
          ‹
        </button>
        <span
          style={{
            fontWeight: 600,
            fontSize: 'var(--font-size-body, 16px)',
            color: 'var(--color-ink, #1f2430)',
            minWidth: 140,
            textAlign: 'center',
          }}
        >
          {formatMonthId(selectedMonth)}
        </span>
        <button
          type="button"
          aria-label="Bulan berikutnya"
          onClick={handleNextMonth}
          disabled={isNextDisabled}
          style={{
            ...navButtonStyle,
            opacity: isNextDisabled ? 0.35 : 1,
            cursor: isNextDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          ›
        </button>
      </div>

      {/* Kartu Ringkasan */}
      {isPending ? (
        <Skeleton height={112} style={{ marginBottom: 16 }} />
      ) : (
        <SoftCard style={{ marginBottom: 16 }}>
          <p
            style={{
              margin: '0 0 12px',
              fontWeight: 700,
              fontSize: 'var(--font-size-body, 16px)',
              color: 'var(--color-ink, #1f2430)',
            }}
          >
            Ringkasan
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8,
              textAlign: 'center',
            }}
          >
            <SummaryCell
              label="Pemasukan"
              amount={summary.income}
              variant="income"
            />
            <SummaryCell
              label="Pengeluaran"
              amount={summary.expense}
              variant="expense"
            />
            <SummaryCell
              label="Selisih"
              amount={summary.net}
              variant={summary.net >= 0 ? 'income' : 'expense'}
            />
          </div>
        </SoftCard>
      )}

      {/* Pesan tidak ada data */}
      {!isPending && !hasTxns && (
        <SoftCard style={{ marginBottom: 16, textAlign: 'center', padding: '32px 16px' }}>
          <p style={{ margin: 0, fontSize: 'var(--font-size-body, 16px)', color: 'var(--color-ink-muted, #6b7280)' }}>
            Tidak ada transaksi pada {formatMonthId(selectedMonth)}.
          </p>
        </SoftCard>
      )}

      {/* Grafik Pengeluaran per Kategori */}
      {(isPending || categoryData.length > 0) && (
        <SoftCard style={{ marginBottom: 16 }}>
          <p
            style={{
              margin: '0 0 12px',
              fontWeight: 700,
              fontSize: 'var(--font-size-body, 16px)',
              color: 'var(--color-ink, #1f2430)',
            }}
          >
            Pengeluaran per Kategori
          </p>
          {isPending ? (
            <Skeleton height={160} />
          ) : (
            <Suspense fallback={<Skeleton height={160} label="Memuat grafik" />}>
              <CategoryBarChart data={categoryData} />
            </Suspense>
          )}
        </SoftCard>
      )}

      {/* Grafik Tren */}
      {(isPending || trendData.length > 0) && (
        <SoftCard style={{ marginBottom: 16 }}>
          <p
            style={{
              margin: '0 0 12px',
              fontWeight: 700,
              fontSize: 'var(--font-size-body, 16px)',
              color: 'var(--color-ink, #1f2430)',
            }}
          >
            Tren Harian
          </p>
          {isPending ? (
            <Skeleton height={200} />
          ) : (
            <Suspense fallback={<Skeleton height={200} label="Memuat grafik" />}>
              <TrendLineChart data={trendData} />
            </Suspense>
          )}
        </SoftCard>
      )}

      {/* Tombol Unduh CSV */}
      <SoftCard style={{ marginBottom: 16 }}>
        <p
          style={{
            margin: '0 0 12px',
            fontWeight: 700,
            fontSize: 'var(--font-size-body, 16px)',
            color: 'var(--color-ink, #1f2430)',
          }}
        >
          Ekspor Data
        </p>
        {!hasTxns && !isPending ? (
          <p
            style={{
              margin: 0,
              fontSize: 'var(--font-size-caption, 13px)',
              color: 'var(--color-ink-muted, #6b7280)',
            }}
          >
            Tidak ada data untuk diekspor.
          </p>
        ) : (
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={isPending || !hasTxns}
            aria-label={`Unduh CSV laporan ${formatMonthId(selectedMonth)}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 44,
              padding: '10px 20px',
              border: 'none',
              borderRadius: 'var(--radius-card, 20px)',
              background: 'var(--color-brand-blue, #005DAC)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: 'var(--font-size-body, 16px)',
              cursor: isPending || !hasTxns ? 'not-allowed' : 'pointer',
              opacity: isPending || !hasTxns ? 0.6 : 1,
            }}
          >
            ⬇ Unduh CSV
          </button>
        )}
      </SoftCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Komponen pembantu
// ---------------------------------------------------------------------------

interface SummaryCellProps {
  label: string;
  amount: number;
  variant: 'income' | 'expense' | 'neutral';
}

function SummaryCell({ label, amount, variant }: SummaryCellProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          fontSize: 'var(--font-size-caption, 13px)',
          color: 'var(--color-ink-muted, #6b7280)',
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <AmountDisplay
        amount={amount}
        variant={variant}
        style={{ fontWeight: 700, fontSize: 'var(--font-size-body, 16px)' }}
      />
    </div>
  );
}

const navButtonStyle: React.CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1.5px solid rgba(31, 36, 48, 0.15)',
  borderRadius: 'var(--radius-card, 20px)',
  background: 'var(--color-card, #fff)',
  color: 'var(--color-ink, #1f2430)',
  fontSize: 20,
  cursor: 'pointer',
  lineHeight: 1,
};

export default ReportPage;
