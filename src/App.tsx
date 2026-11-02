/**
 * Komponen utama aplikasi Arto (Tugas 12.1, 12.14).
 *
 * Urutan inisialisasi modul:
 * 1. `configureAmplify()` dipanggil saat modul ini dimuat (efek samping
 *    tingkat modul), sebelum React merender apa pun.
 * 2. QueryClientProvider membungkus seluruh pohon komponen.
 * 3. I18n Amplify UI di-override agar label dan pesan galat berbahasa Indonesia.
 * 4. Authenticator dijadikan shell login; bila sudah masuk, Router + Routes
 *    diarahkan ke AuthenticatedLayout yang menampung semua rute halaman.
 *
 * Pemecahan kode (code splitting, Req 15.6):
 * - Setiap halaman dimuat lewat `React.lazy` sehingga hanya chunk yang
 *   dibutuhkan saat ini yang diunduh oleh peramban.
 * - Suspense memasang `<PageFallback />` (Skeleton) selama chunk dimuat.
 * - Saat idle, chunk TransactionsPage di-prefetch agar BottomSheet transaksi
 *   terbuka dalam < 300 ms (Req 17.1).
 */

import { lazy, Suspense, useEffect } from 'react';
import { Authenticator, translations } from '@aws-amplify/ui-react';
import { I18n } from 'aws-amplify/utils';
import '@aws-amplify/ui-react/styles.css';
import './theme/auth.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { configureAmplify } from './app/amplify';
import { queryClient } from './app/queryClient';
import { LOGIN_ERROR_VOCABULARY } from './auth/errors';
import { AuthenticatedLayout } from './AuthenticatedLayout';
import { ArtoLogo } from './components/ArtoLogo';
import { Skeleton } from './components/Skeleton';

// ---------------------------------------------------------------------------
// Lazy-loaded pages (code splitting per rute, Req 15.6)
// ---------------------------------------------------------------------------

const HomePage         = lazy(() => import('./pages/HomePage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const WalletsPage      = lazy(() => import('./pages/WalletsPage'));
const CategoriesPage   = lazy(() => import('./pages/CategoriesPage'));
const BudgetPage       = lazy(() => import('./pages/BudgetPage'));
const RecurringPage    = lazy(() => import('./pages/RecurringPage'));
const GoalsPage        = lazy(() => import('./pages/GoalsPage'));
const ReportPage       = lazy(() => import('./pages/ReportPage'));
const AssistantPage    = lazy(() => import('./pages/AssistantPage'));
const InsightsPage     = lazy(() => import('./pages/InsightsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const SettingsPage     = lazy(() => import('./pages/SettingsPage'));
const GroupPage       = lazy(() => import('./pages/GroupPage'));
const JoinGroupPage    = lazy(() => import('./pages/JoinGroupPage'));

// ---------------------------------------------------------------------------
// Inisialisasi Amplify (sekali saat modul dimuat)
// ---------------------------------------------------------------------------

configureAmplify();

// ---------------------------------------------------------------------------
// Terjemahan Amplify UI → Bahasa Indonesia
// ---------------------------------------------------------------------------

I18n.putVocabularies(translations);
I18n.setLanguage('id');

I18n.putVocabulariesForLanguage('id', {
  // Pesan galat uniformitas kredensial (Req 1.4)
  ...LOGIN_ERROR_VOCABULARY,

  // Label formulir
  'Sign In': 'Masuk',
  'Sign in': 'Masuk',
  'Sign Up': 'Daftar',
  'Sign up': 'Daftar',
  'Sign Out': 'Keluar',
  'Sign out': 'Keluar',
  'Email': 'Email',
  'Password': 'Kata Sandi',
  'Confirm Password': 'Konfirmasi Kata Sandi',
  'Forgot your password?': 'Lupa kata sandi?',
  'Reset password': 'Reset kata sandi',
  'Enter your email': 'Masukkan email Anda',
  'Enter your Password': 'Masukkan kata sandi Anda',
  'Please confirm your Password': 'Konfirmasi kata sandi Anda',
  'Send code': 'Kirim kode',
  'Submit': 'Kirim',
  'Back to Sign In': 'Kembali ke halaman masuk',
  'Code': 'Kode verifikasi',
  'Confirmation Code': 'Kode konfirmasi',
  'Enter your code': 'Masukkan kode verifikasi',
  'New Password': 'Kata Sandi Baru',
  'Enter your new password': 'Masukkan kata sandi baru Anda',
  'Loading': 'Memuat…',
  'We Emailed You': 'Kami Mengirim Email',
  'Your code is on the way. To log in, enter the code we emailed to':
    'Kode verifikasi sedang dikirim ke',
  'It may take a minute to arrive.': 'Mungkin butuh beberapa saat.',
  'Resend Code': 'Kirim ulang kode',
  'An account with the given email already exists.':
    'Email ini sudah terdaftar. Silakan masuk.',
  'Password must have at least 8 characters':
    'Kata sandi minimal 8 karakter.',
});

// ---------------------------------------------------------------------------
// Formulir login: hanya email + password
// ---------------------------------------------------------------------------

const formFields = {
  signIn: {
    username: {
      label: 'Email',
      placeholder: 'Masukkan email Anda',
      isRequired: true,
    },
    password: {
      label: 'Kata Sandi',
      placeholder: 'Masukkan kata sandi Anda',
      isRequired: true,
    },
  },
  signUp: {
    email: {
      label: 'Email',
      placeholder: 'Masukkan email Anda',
      order: 1,
      isRequired: true,
    },
    password: {
      label: 'Kata Sandi',
      placeholder: 'Buat kata sandi (min. 8 karakter)',
      order: 2,
      isRequired: true,
    },
    confirm_password: {
      label: 'Konfirmasi Kata Sandi',
      placeholder: 'Ulangi kata sandi Anda',
      order: 3,
      isRequired: true,
    },
  },
  forgotPassword: {
    username: {
      label: 'Email',
      placeholder: 'Masukkan email Anda',
      isRequired: true,
    },
  },
};

// ---------------------------------------------------------------------------
// Fallback Suspense: tiga blok Skeleton di atas area konten
// ---------------------------------------------------------------------------

function PageFallback() {
  return (
    <div style={{ padding: '24px 16px' }}>
      <Skeleton height={36} width="55%" style={{ marginBottom: 24 }} label="Memuat halaman" />
      <Skeleton height={116} style={{ marginBottom: 12, borderRadius: 'var(--radius-card)' }} />
      <Skeleton height={116} style={{ marginBottom: 12, borderRadius: 'var(--radius-card)' }} />
      <Skeleton height={116} style={{ borderRadius: 'var(--radius-card)' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prefetch saat idle: muat chunk TransactionsPage agar BottomSheet
// transaksi terbuka dalam < 300 ms saat pertama kali dibuka (Req 17.1).
// ---------------------------------------------------------------------------

function useIdlePrefetch() {
  useEffect(() => {
    const ric =
      typeof requestIdleCallback !== 'undefined'
        ? requestIdleCallback
        : (cb: () => void) => window.setTimeout(cb, 300);
    const id = ric(() => {
      void import('./pages/TransactionsPage');
    });
    return () => {
      if (typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(id as number);
      }
    };
  }, []);
}

// ---------------------------------------------------------------------------
// Komponen root: App
// ---------------------------------------------------------------------------

/**
 * Slot komponen Authenticator.
 *
 * Halaman masuk sebelumnya tidak memuat identitas visual apa pun, sehingga
 * pengguna tidak tahu sedang membuka aplikasi apa. Logo dipasang lewat slot
 * `Header` resmi Amplify UI agar tetap ikut tata letak dan jarak formulirnya.
 */
const authComponents = {
  Header() {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          padding: '32px 16px 12px',
          color: 'var(--color-ink, #1f2430)',
        }}
      >
        <ArtoLogo height={104} title="Arto" />
        <p
          style={{
            margin: 0,
            textAlign: 'center',
            fontSize: 'var(--font-size-caption, 13px)',
            color: 'var(--color-ink-muted, #6b7280)',
          }}
        >
          Catat pengeluaran harian, pantau anggaran, capai target.
        </p>
      </div>
    );
  },
};

export function App() {
  useIdlePrefetch();

  return (
    <QueryClientProvider client={queryClient}>
      {/*
        Latar gradien mesh (Req 18.7) dirender di sini, bukan di dalam
        AuthenticatedLayout, agar halaman masuk memakai latar yang sama
        dengan tampilan setelah masuk.
      */}
      <div id="app-bg" aria-hidden="true" />
      <BrowserRouter>
        <Authenticator
          loginMechanisms={['email']}
          formFields={formFields}
          hideSignUp={false}
          components={authComponents}
        >
          {() => (
            <Routes>
              {/* AuthenticatedLayout menyediakan shell (top bar + bottom nav + Outlet) */}
              <Route element={<AuthenticatedLayout />}>
                <Route
                  path="/"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <HomePage />
                    </Suspense>
                  }
                />
                <Route
                  path="/transaksi"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <TransactionsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/dompet"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <WalletsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/kategori"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <CategoriesPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/anggaran"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <BudgetPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/berulang"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <RecurringPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/target"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <GoalsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/laporan"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <ReportPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/asisten"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <AssistantPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/wawasan"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <InsightsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/notifikasi"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <NotificationsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/pengaturan"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <SettingsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/grup"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <GroupPage />
                    </Suspense>
                  }
                />
                {/* Catch-all: arahkan ke beranda */}
                <Route
                  path="*"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <HomePage />
                    </Suspense>
                  }
                />
              </Route>

              {/* Penerimaan undangan — di luar AuthenticatedLayout agar
                  dapat diakses sebelum login, token disimpan ke sessionStorage */}
              <Route
                path="/bergabung"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <JoinGroupPage />
                  </Suspense>
                }
              />
            </Routes>
          )}
        </Authenticator>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
