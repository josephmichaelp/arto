# Implementation Plan: Arto Expense Tracker

## Overview

Implementasi memakai TypeScript di atas AWS Amplify Gen2 (React 18 + Vite di frontend). Urutan kerjanya bertahap: scaffold proyek, fungsi domain murni di `shared/domain` (dengan uji properti opsional), backend Amplify (auth, data, storage, fungsi Lambda), gateway AI dengan resolver model, proses terjadwal, UI React mobile-first, PWA, dan skrip verifikasi `scripts/verify-bedrock.ts`.

Asumsi default region (keputusan hosting, Opsi A pada dokumen desain):

- Amplify Hosting dan seluruh backend Amplify berjalan di `ap-southeast-1` (Singapura), karena Amplify tidak tersedia di `ap-southeast-3`.
- Lambda `ai-gateway` dan `weekly-insight` memanggil Bedrock di `ap-southeast-3` (Jakarta) lewat variabel lingkungan `BEDROCK_REGION` (default `ap-southeast-3`). Region ini tidak boleh tertanam di kode, sehingga pindah ke Opsi B tidak mengubah logika AI.
- Rantai kandidat model: C1 `amazon.nova-lite-v1:0`, C2 `apac.amazon.nova-lite-v1:0` (keduanya di `ap-southeast-3`), lalu C3 `apac.amazon.nova-lite-v1:0` di `ap-southeast-1`. Dapat ditimpa lewat `AI_MODEL_CANDIDATES`, dan `AI_ALLOW_CROSS_REGION=false` memaksa C1 saja.
- Ketersediaan EventBridge Scheduler di `ap-southeast-3` tidak relevan pada asumsi ini karena backend berada di `ap-southeast-1`.

Pembaruan (Requirement 15.7, 17, dan 18; Properti 28 sampai 34; bagian Design System pada dokumen desain):

- Tugas 1 sampai 15 dipertahankan beserta penomorannya. Tugas 12 diperluas agar setiap halaman menerapkan Design System.
- Tugas baru 16 sampai 20 menambah repositori dan pemindaian rahasia (16), token tema dan latar gradien (17), fungsi domain murni Design System (18), tumpukan font tanpa berkas SF (19), serta komponen UI dan gerak (20). Tugas 21 adalah checkpoint akhir.
- Urutan eksekusi mengikuti `Task Dependency Graph`, bukan urutan nomor. Menurut graf tersebut, prasyarat tugas 12.1 dari tugas 17 sampai 20 hanya 17.1 sampai 17.3, 19.1, dan 20.1 sampai 20.4. Sub-tugas lain di rentang itu (misalnya tugas 18 dan semua uji opsional) tidak menahan 12.1.
- Nilai hex Warna_Merek (Oat, Biru, Merah_Muda) adalah pendekatan layar dan belum dikonfirmasi pemilik. Nilai Merah_Muda masih placeholder.
- Repositori jarak jauh adalah `https://github.com/josephmichaelp/arto.git`. Token, kata sandi, atau kredensial apa pun tidak boleh ditulis di berkas, URL remote, skrip, atau riwayat git.

## Tasks

- [x] 1. Scaffold proyek dan konfigurasi dasar
  - [x] 1.1 Inisialisasi proyek Vite + React 18 + TypeScript dan Amplify Gen2
    - Buat `package.json`, `tsconfig.json`, `vite.config.ts`, dan struktur direktori `amplify/`, `shared/domain/`, `src/`, `scripts/`
    - Pasang semua dependensi dengan versi dipin di awal: `aws-amplify`, `@aws-amplify/backend`, `@aws-amplify/ui-react`, `react-router-dom`, `@tanstack/react-query`, `recharts`, `pdfmake`, `vite-plugin-pwa`, `zod`, `web-push`, `@aws-sdk/client-bedrock`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3`, `vitest`, `fast-check`, `@testing-library/react`, `axe-core`
    - Atur alias path agar `shared/domain` dapat diimpor dari `src/` dan `amplify/functions/*`
    - Atur skrip `test` memakai `vitest --run`
    - _Requirements: 15.1_

  - [x] 1.2 Buat konfigurasi lingkungan dan region default
    - Buat `shared/config.ts` yang membaca `BEDROCK_REGION` (default `ap-southeast-3`), `AI_MODEL_CANDIDATES`, `AI_ALLOW_CROSS_REGION`, dan `AI_RATE_LIMIT` (default 30)
    - Buat `.env.example` dan `amplify.yml` dasar dengan hosting di `ap-southeast-1`
    - _Requirements: 16.1_

- [ ] 2. Domain murni: tipe, uang, dan tanggal
  - [x] 2.1 Buat tipe bersama dan helper pemilik
    - Tulis `shared/domain/types.ts` (Rupiah, Txn, Wallet, Category, Budget, RuleLike, Notification, NotifPrefs, ExportRow, dan tipe terkait)
    - Tulis `ownerOf(identity)` yang menghasilkan `<sub>::<username>` dan menolak identitas kosong
    - _Requirements: 1.6, 16.2_

  - [~] 2.2 Implementasi `money.ts`
    - `formatRupiah`, `parseRupiah`, `parseAmountShorthand`, `validateAmount`
    - Pesan galat: "Nominal harus berupa angka bulat lebih dari 0"
    - _Requirements: 2.4, 2.7, 2.8, 10.2_

  - [~] 2.3 Tulis uji properti format Rupiah
    - **Property 1: Format Rupiah round trip**
    - **Validates: Requirements 2.7, 2.8, 14.3**

  - [~] 2.4 Tulis uji properti penafsiran nominal singkat
    - **Property 2: Penafsiran nominal singkat**
    - **Validates: Requirements 10.2**

  - [~] 2.5 Tulis uji properti validasi nominal
    - **Property 5: Validasi nominal**
    - **Validates: Requirements 2.4, 5.1, 7.1**

  - [~] 2.6 Implementasi `dates.ts`
    - `toJakartaDate`, `toJakartaMonth`, `formatDateId` (nama bulan bahasa Indonesia), `weekRangeEnding`, `addDays`, `daysInMonth`
    - _Requirements: 5.2, 10.6, 13.1, 15.3_

  - [~] 2.7 Tulis uji properti tanggal WIB
    - **Property 19: Tanggal dan batas hari mengikuti WIB**
    - **Validates: Requirements 10.6, 15.3**

- [ ] 3. Domain murni: logika keuangan
  - [~] 3.1 Implementasi `ledger.ts`
    - `applyEvents` dan `planTransfer` (tolak bila nominal melebihi saldo asal atau nominal tidak lebih dari 0)
    - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4, 7.2, 7.6_

  - [~] 3.2 Tulis uji properti saldo Dompet
    - **Property 3: Saldo Dompet konsisten dengan riwayat operasi**
    - **Validates: Requirements 2.1, 2.2, 2.3, 4.1, 4.2**

  - [~] 3.3 Tulis uji properti transfer dan setoran
    - **Property 4: Transfer dan setoran menjaga total dan menolak saldo kurang**
    - **Validates: Requirements 4.3, 4.4, 7.2, 7.6**

  - [~] 3.4 Implementasi `budget.ts`
    - `budgetStatus`, `thresholdCrossings` (perbandingan bilangan bulat: `spent * 100 >= amount * 80` dan `spent > amount`), `copyBudgets`, dan fungsi realisasi per bulan WIB
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6_

  - [~] 3.5 Tulis uji properti realisasi anggaran
    - **Property 8: Realisasi dan sisa anggaran mengikuti bulan WIB**
    - **Validates: Requirements 5.2, 5.3**

  - [~] 3.6 Tulis uji properti salin anggaran
    - **Property 10: Salin anggaran**
    - **Validates: Requirements 5.6**

  - [~] 3.7 Implementasi `recurring.ts`
    - `occurrence` (indeks dari tanggal mulai asli, clamp akhir bulan), `dueOccurrences` (batas 366 per eksekusi), `reminderDue` (H-3)
    - _Requirements: 6.2, 6.3, 6.5_

  - [~] 3.8 Tulis uji properti jatuh tempo berulang
    - **Property 11: Tanggal jatuh tempo berulang dengan clamp akhir bulan**
    - **Validates: Requirements 6.2, 6.3, 6.5**

  - [~] 3.9 Implementasi `goals.ts`
    - `goalProgress` dan `monthlyNeeded` (pembulatan ke atas, minimal 1 bulan)
    - _Requirements: 7.3, 7.4, 7.5_

  - [~] 3.10 Tulis uji properti Target_Tabungan
    - **Property 14: Progres dan kebutuhan setoran bulanan Target_Tabungan**
    - **Validates: Requirements 7.3, 7.4, 7.5**

  - [~] 3.11 Implementasi `report.ts`
    - `summarize`, `byCategory`, `trend` (bucket hari, minggu, bulan); transfer dan setoran target tidak ikut dihitung
    - _Requirements: 4.6, 8.1, 8.2, 8.3_

  - [~] 3.12 Tulis uji properti total laporan
    - **Property 6: Total laporan mengabaikan transfer**
    - **Validates: Requirements 4.6, 8.1, 8.2**

  - [~] 3.13 Tulis uji properti bucket tren
    - **Property 7: Bucket tren menjumlahkan total**
    - **Validates: Requirements 8.3**

  - [~] 3.14 Implementasi `filters.ts`
    - `applyFilters` (konjungtif), pengurutan tanggal menurun, dan `paginate` (default 20)
    - _Requirements: 2.5, 2.6_

  - [~] 3.15 Tulis uji properti filter transaksi
    - **Property 20: Filter transaksi bersifat konjungtif**
    - **Validates: Requirements 2.6**

  - [~] 3.16 Tulis uji properti urutan dan halaman
    - **Property 21: Urutan dan halaman daftar transaksi**
    - **Validates: Requirements 2.5**

  - [~] 3.17 Implementasi `csv.ts`
    - `toCsv` (UTF-8, nominal bilangan bulat tanpa pemisah, escape koma, kutip, dan baris baru) dan `fromCsv`
    - _Requirements: 14.1, 14.3, 14.5_

  - [~] 3.18 Tulis uji properti CSV
    - **Property 13: CSV round trip**
    - **Validates: Requirements 14.1, 14.3, 14.5**

- [ ] 4. Domain murni: validasi AI, pembatas, log, dan notifikasi
  - [~] 4.1 Implementasi `ai-validate.ts`
    - `validateNlResult`, `validateReceiptResult` (status `needs_amount`, `categoryId` hanya dari daftar Pengguna, tanggal kosong diganti `todayWib`)
    - `validateUpload` (JPEG/PNG, lebih dari 0 dan paling besar 5 * 1024 * 1024 byte) dan `formatAmountsInText`
    - _Requirements: 10.2, 10.5, 10.6, 10.7, 11.1, 11.3, 11.4, 12.2_

  - [~] 4.2 Tulis uji properti hasil AI tidak valid
    - **Property 15: Hasil AI yang tidak lengkap atau tidak valid tidak pernah disimpan otomatis**
    - **Validates: Requirements 10.5, 10.6, 10.7, 11.4**

  - [~] 4.3 Tulis uji properti validasi unggahan struk
    - **Property 16: Validasi unggahan struk**
    - **Validates: Requirements 11.1, 11.3**

  - [~] 4.4 Tulis uji properti nominal pada jawaban asisten
    - **Property 17: Nominal pada jawaban asisten berformat Rupiah**
    - **Validates: Requirements 12.2**

  - [~] 4.5 Implementasi `rate-limit.ts`
    - `decideRate` (default 30) dan `hourBucket` (jendela tetap per jam UTC)
    - _Requirements: 16.3_

  - [~] 4.6 Tulis uji properti pembatas pemakaian (logika murni)
    - **Property 23: Pembatas pemakaian AI**
    - **Validates: Requirements 16.3**

  - [~] 4.7 Implementasi `redact.ts`
    - `safeLogPayload` dengan daftar putih kunci `name`, `code`, `httpStatus`, `requestId`, `candidate`, `inputLength`
    - _Requirements: 16.4_

  - [~] 4.8 Tulis uji properti log
    - **Property 24: Log tidak memuat data keuangan**
    - **Validates: Requirements 16.4**

  - [~] 4.9 Implementasi `notify.ts`
    - `shouldCreate` dan `notificationId` (ID deterministik, misalnya `budget80:<budgetId>`)
    - _Requirements: 9.1, 9.5_

  - [~] 4.10 Tulis uji properti notifikasi
    - **Property 26: Notifikasi, penanda belum dibaca, dan preferensi**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5**

- [~] 5. Checkpoint - Pastikan semua uji lulus
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Backend Amplify: auth, storage, data, dan fungsi
  - [~] 6.1 Definisikan autentikasi di `amplify/auth/resource.ts`
    - `defineAuth` dengan `loginWith.email`, kode verifikasi email berbahasa Indonesia, dan trigger `postConfirmation`
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [~] 6.2 Definisikan penyimpanan di `amplify/storage/resource.ts`
    - Bucket privat untuk `receipts/<sub>/*` tanpa akses klien langsung
    - _Requirements: 11.5_

  - [~] 6.3 Definisikan resource fungsi
    - Buat `resource.ts` untuk `ledger`, `ai-gateway`, `recurring-runner`, `weekly-insight`, dan `post-confirmation` memakai `defineFunction`
    - Atur variabel lingkungan `BEDROCK_REGION` (default `ap-southeast-3`), `AI_MODEL_CANDIDATES`, `AI_ALLOW_CROSS_REGION`, serta timeout `ai-gateway` 25 detik
    - _Requirements: 16.1, 12.5_

  - [~] 6.4 Definisikan skema data di `amplify/data/resource.ts`
    - Semua model dengan `allow.owner()` (baca saja untuk model yang memengaruhi saldo), indeks `listTxByDate` dan `listRulesDue`
    - Custom mutation/query untuk `ledger` dan `ai-gateway` dengan `allow.authenticated()`
    - Tanpa API key dan tanpa akses publik
    - _Requirements: 1.6, 1.7, 1.8, 16.2_

  - [~] 6.5 Rangkai `amplify/backend.ts`
    - Tabel `AiUsage` dengan TTL, `preventUserExistenceErrors = ENABLED` pada app client, dan secret VAPID
    - Kebijakan IAM `bedrock:InvokeModel` untuk `ai-gateway` dan `weekly-insight` pada foundation model dan inference profile (termasuk kondisi `bedrock:InferenceProfileArn`), serta akses S3 dan DynamoDB
    - Jadwal EventBridge Scheduler (CDK `aws-scheduler`) dengan `scheduleExpressionTimezone: 'Asia/Jakarta'`: harian 00:05 ke `recurring-runner`, Senin 00:30 ke `weekly-insight`
    - _Requirements: 1.4, 6.2, 13.1, 16.1, 16.2_

  - [~] 6.6 Implementasi `post-confirmation`
    - Tulis `UserProfile`, `NotifPrefs`, Kategori bawaan berbahasa Indonesia, dan Dompet "Tunai" saldo 0 dengan `attribute_not_exists`
    - _Requirements: 3.1, 1.2_

  - [~] 6.7 Tulis uji unit `post-confirmation`
    - Verifikasi Kategori bawaan lengkap dan pengulangan trigger tidak membuat data ganda
    - _Requirements: 3.1_

- [ ] 7. Lambda ledger
  - [~] 7.1 Buat lapisan repositori
    - Antarmuka repositori (transaksi tulis atomik, penulisan kondisional), implementasi DynamoDB `TransactWriteItems`, dan implementasi in-memory untuk uji
    - _Requirements: 2.1, 6.6_

  - [~] 7.2 Buat helper notifikasi, push, dan evaluasi ambang anggaran
    - `createNotification(type, ref, payload, prefs)` dengan ID deterministik dan `attribute_not_exists`
    - Pengirim Web Push (`web-push`, hapus langganan status 404/410)
    - Evaluator ambang anggaran memakai `thresholdCrossings` dan set flag `warn80Sent`/`over100Sent`
    - _Requirements: 5.4, 5.5, 9.1, 9.4, 9.5_

  - [~] 7.3 Implementasi operasi transaksi dan transfer
    - `saveTransaction` (baru dan ubah, termasuk penggabungan delta bila Dompet sama), `deleteTransaction`, `transferFunds` dengan kondisi saldo cukup
    - Isi `searchText`, petakan `ConditionalCheckFailed` ke "Saldo dompet asal tidak cukup", dan panggil evaluator anggaran setelah perubahan pengeluaran
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.3, 4.4, 5.4, 5.5_

  - [~] 7.4 Implementasi operasi Dompet dan Kategori
    - Buat, ubah nama, dan hapus dengan `*WithReassign` (potongan 25 item, idempoten), item penjaga `UNIQ#<owner>#<type>#<nameKey>`, kode `NEEDS_REPLACEMENT`, dan hapus Anggaran milik Kategori yang dihapus
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 4.1, 4.5_

  - [~] 7.5 Implementasi operasi Anggaran, aturan berulang, dan Target_Tabungan
    - `upsertBudget`, `copyBudgetsFromPreviousMonth` (ID `categoryId#month`, tidak menimpa), CRUD aturan berulang termasuk jeda, CRUD Target_Tabungan, dan `depositToGoal` dengan notifikasi `goal-done:<goalId>`
    - _Requirements: 5.1, 5.6, 6.1, 6.4, 7.1, 7.2, 7.4, 7.6_

  - [~] 7.6 Rangkai `ledger/handler.ts`
    - Router operasi berdasarkan nama field, ambil `owner` dari `event.identity`, dan tolak bila identitas kosong
    - _Requirements: 1.6, 16.2_

  - [~] 7.7 Tulis uji properti notifikasi ambang anggaran
    - **Property 9: Notifikasi ambang anggaran sekali per bulan**
    - **Validates: Requirements 5.4, 5.5**

  - [~] 7.8 Tulis uji properti keunikan dan reassign
    - **Property 22: Keunikan dan reassign Kategori serta Dompet**
    - **Validates: Requirements 3.3, 3.5, 4.5**

  - [~] 7.9 Tulis uji properti isolasi pemilik pada ledger
    - **Property 18: Isolasi data antar pemilik**
    - **Validates: Requirements 1.6, 1.8**

- [ ] 8. Gateway AI dan resolver model
  - [~] 8.1 Implementasi `model-resolver.ts`
    - Rantai kandidat C1 sampai C3 dari konfigurasi, pindah kandidat hanya untuk `AccessDeniedException`, `ResourceNotFoundException`, dan `ValidationException` model tidak valid
    - Galat sementara dicoba ulang sekali tanpa pindah kandidat, indeks terpilih disimpan di memori modul, `AI_ALLOW_CROSS_REGION=false` memaksa C1, dan galat `AI_MODEL_UNAVAILABLE` bila semua gagal
    - Region panggilan dibaca dari `BEDROCK_REGION`
    - _Requirements: 16.1_

  - [~] 8.2 Tulis uji properti resolver model
    - **Property 25: Resolusi model memilih kandidat tersedia pertama**
    - **Validates: Requirements 16.1**

  - [~] 8.3 Buat klien Bedrock dan `prompts.ts`
    - Pembungkus Converse dengan timeout klien 20 detik, log aman lewat `safeLogPayload`, dan pemetaan galat `AI_UNAVAILABLE`
    - Prompt sistem berbahasa Indonesia dengan pembatas data pengguna anti prompt injection
    - _Requirements: 12.1, 16.1, 16.4_

  - [~] 8.4 Implementasi pembatas pemakaian
    - `UpdateItem ADD` pada `USAGE#<sub>#<hourBucket>` dengan `ConditionExpression` batas 30 dan TTL 2 jam, galat `RATE_LIMITED` berbahasa Indonesia
    - _Requirements: 16.3_

  - [~] 8.5 Implementasi `parseNaturalInput`
    - Panggil model, validasi dengan Zod (satu percobaan ulang), hitung nominal lewat `parseAmountShorthand`, lalu `validateNlResult`
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6, 10.7_

  - [~] 8.6 Implementasi `createReceiptUpload` dan `scanReceipt`
    - Presigned POST ke `receipts/<sub>/<uuid>` dengan `content-length-range` dan `Content-Type` tepat, verifikasi awalan kunci, dan kirim gambar ke Converse sebagai blok `image`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [~] 8.7 Implementasi `askAssistant`
    - Konteks hanya dari data Pengguna terautentikasi (ringkasan bulan berjalan, 5 Kategori terbesar, status anggaran, saldo Dompet, hingga 50 transaksi terbaru)
    - Tolak pertanyaan di luar keuangan, dan lewatkan jawaban ke `formatAmountsInText`
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [~] 8.8 Rangkai `ai-gateway/handler.ts`
    - Tolak identitas kosong, terapkan pembatas pemakaian sebelum memanggil Bedrock, lalu arahkan ke operasi AI
    - _Requirements: 16.2, 16.3_

  - [~] 8.9 Tulis uji pembatas pemakaian terintegrasi
    - **Property 23: Pembatas pemakaian AI**
    - Verifikasi permintaan ke-31 ditolak tanpa memanggil klien Bedrock palsu dan jam berikutnya diizinkan lagi
    - **Validates: Requirements 16.3**

  - [~] 8.10 Tulis uji properti isolasi konteks AI
    - **Property 18: Isolasi data antar pemilik**
    - Verifikasi pembangun konteks `askAssistant` hanya memuat data pemilik
    - **Validates: Requirements 12.3, 16.2**

  - [~] 8.11 Tulis uji unit handler tanpa identitas
    - Handler `ai-gateway` tanpa identitas mengembalikan galat dan tidak memanggil Bedrock
    - _Requirements: 16.2_

- [~] 9. Checkpoint - Pastikan semua uji lulus
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Proses terjadwal
  - [~] 10.1 Implementasi `recurring-runner`
    - Kueri `listRulesDue` (`ACTIVE`, `nextDueOn <= today`), `dueOccurrences`, Put Transaction ID `rec:<ruleId>:<dueDate>` + Update Wallet dalam satu transaksi, pembaruan aturan dengan kondisi `nextIndex = :expected`
    - Notifikasi pengingat `recrem:<ruleId>:<dueDate>` dan evaluasi ambang anggaran
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

  - [~] 10.2 Tulis uji properti idempotensi pembuatan transaksi berulang
    - **Property 12: Pembuatan transaksi berulang idempoten**
    - **Validates: Requirements 6.2, 6.4, 6.6, 13.3**

  - [~] 10.3 Implementasi `weekly-insight`
    - Pindai `UserProfile`, lewati Pengguna tanpa Transaksi, hitung total dan Kategori terbesar secara deterministik, minta ringkasan dan saran dari Nova Lite dengan saran bawaan bila gagal
    - Simpan `WeeklyInsight` (ID `weekStart`) dan Notifikasi `insight:<weekStart>` secara kondisional
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [~] 10.4 Tulis uji properti isi Wawasan_Mingguan
    - **Property 27: Isi Wawasan_Mingguan berasal dari agregasi deterministik**
    - **Validates: Requirements 13.1, 13.2, 13.4**

- [~] 11. Checkpoint - Pastikan semua uji lulus
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Frontend React mobile-first
  - [~] 12.1 Buat kerangka aplikasi
    - Konfigurasi Amplify, `I18n.setLanguage('id')`, `Authenticator` berbahasa Indonesia, pemetaan galat login ke "Email atau kata sandi salah", route guard ke halaman masuk, navigasi bawah tetap dengan penanda belum dibaca
    - CSS satu kolom 320 px sampai 480 px, target sentuh minimal 44 x 44 px, kontras minimal 4,5:1
    - Terapkan Design System: impor `tokens.css`, `global.css`, dan font dari `src/theme`, pasang elemen `#app-bg` (Latar_Gradien), `GlassBar` untuk bilah atas dan bilah navigasi bawah, `QuickAddFab` (hanya Beranda, Transaksi, dan Laporan), wadah rute dengan `navigateWithTransition` dan fallback CSS, serta `useReducedMotion` yang memasang `data-motion` pada `<html>`
    - _Requirements: 1.3, 1.4, 1.7, 15.1, 15.2, 15.4, 15.5, 15.7, 17.1, 17.5, 17.8, 17.11, 18.7, 18.8_

  - [~] 12.2 Tulis uji pemetaan galat login dan route guard
    - Galat `NotAuthorizedException` dan `UserNotFoundException` menghasilkan satu pesan yang sama, dan akses tanpa sesi diarahkan ke halaman masuk
    - _Requirements: 1.4, 1.7_

  - [~] 12.3 Buat komponen bersama dan hook data
    - Komponen nominal (`inputmode="numeric"`, label teks, galat pada kolom), tampilan tanggal lewat `formatDateId`, hook TanStack Query untuk model dan mutation ledger/AI, serta keadaan kosong dan galat berbahasa Indonesia
    - Gunakan `SoftCard`, `Skeleton` (saat query `pending`), dan `LargeTitle` sebagai pembungkus bersama; angka nominal memakai angka tabular
    - _Requirements: 2.4, 2.7, 15.1, 15.3, 15.5, 15.7, 17.9, 17.10, 18.1_

  - [~] 12.4 Halaman Dompet dan Kategori
    - Kelola Dompet dan Kategori, total saldo, pemindahan dana, serta dialog pengganti saat menghapus yang memiliki Transaksi
    - Terapkan Design System: `LargeTitle`, `SoftCard` untuk Dompet dan Kategori, pemilih Kategori dan Dompet serta konfirmasi hapus/pengganti pada `BottomSheet`, dan `Skeleton` saat memuat
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 15.7, 17.3, 17.9, 17.10_

  - [~] 12.5 Halaman Transaksi
    - Daftar tak hingga 20 item per halaman lewat `listTxByDate`, filter (terus memuat sampai terkumpul 20 atau token habis), formulir tambah, ubah, dan hapus dengan konfirmasi
    - Terapkan Design System: `LargeTitle`, daftar dikelompokkan per hari pada `SoftCard`, `Skeleton` saat memuat, formulir tambah/ubah, filter lengkap, dan konfirmasi hapus pada `BottomSheet` (status di URL query `?sheet=`), serta `QuickAddFab`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 15.7, 17.1, 17.2, 17.3, 17.4, 17.9, 17.10_

  - [~] 12.6 Halaman Anggaran
    - Daftar Anggaran dengan bar progres, sisa, persen terpakai, dan tombol salin bulan lalu
    - Terapkan Design System: `LargeTitle`, `SoftCard` per Anggaran, bar progres memakai `transform: scaleX` dengan teks atau ikon pada ambang 80 dan 100 persen (tidak hanya warna), `Skeleton`, dan pengaturan nominal pada `BottomSheet`
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 15.7, 17.3, 17.9, 17.10, 17.14_

  - [~] 12.7 Halaman Transaksi Berulang dan Target Tabungan
    - Kelola aturan berulang (jeda, hapus), Target_Tabungan, setoran, progres, dan setoran bulanan yang diperlukan
    - Terapkan Design System: `LargeTitle`, `SoftCard` untuk aturan dan Target_Tabungan, formulir dan konfirmasi pada `BottomSheet`, `Skeleton`, dan umpan balik gerak mikro saat setoran berhasil
    - _Requirements: 6.1, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 15.7, 17.3, 17.6, 17.9, 17.10_

  - [~] 12.8 Halaman Beranda
    - Total saldo, ringkasan bulan berjalan, Anggaran terdekat batas, tombol tambah cepat, dan komponen input bahasa alami
    - Terapkan Design System: judul besar "Halo, {nama}" lewat `LargeTitle` yang mengecil saat gulir, kartu saldo, Anggaran, Target, dan Wawasan pada `SoftCard`, `Skeleton`, serta `QuickAddFab` yang membuka `BottomSheet`
    - _Requirements: 2.7, 4.2, 5.3, 10.1, 15.7, 17.1, 17.2, 17.7, 17.9, 17.10_

  - [~] 12.9 Halaman Laporan dan ekspor
    - Pilihan rentang, total, grafik kategori dan tren (Recharts, dimuat `React.lazy`), tombol "Lihat tabel", keadaan kosong
    - Ekspor CSV (BOM UTF-8) dan PDF (`pdfmake`, Format_Rupiah), serta pesan "Tidak ada data untuk diekspor" tanpa membuat berkas
    - Terapkan Design System: `LargeTitle`, grafik dan ringkasan pada `SoftCard`, `Skeleton` pada area grafik saat memuat, pemilih rentang dan opsi ekspor pada `BottomSheet`, serta `QuickAddFab`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 14.1, 14.2, 14.3, 14.4, 14.5, 15.7, 17.1, 17.9, 17.10_

  - [~] 12.10 Input bahasa alami dan pemindai struk
    - Pratinjau yang dapat diedit sebelum disimpan, permintaan melengkapi nominal bila `needs_amount`, validasi JPEG/PNG maksimal 5 MB di klien, unggah lewat presigned POST, dan tautan struk ke Transaksi
    - Terapkan Design System: tampilkan "Ketik bebas" dan "Pindai struk" sebagai pintasan di dalam `BottomSheet` Aksi_Cepat_Tambah, pratinjau hasil pada `SoftCard`, dan `Skeleton` saat AI memproses
    - _Requirements: 10.3, 10.4, 10.5, 11.1, 11.2, 11.3, 11.4, 11.6, 15.7, 17.2, 17.3, 17.10_

  - [~] 12.11 Halaman Asisten
    - Chat dengan pernyataan tetap "informasi umum, bukan nasihat keuangan profesional", `AbortController` 30 detik, tombol "Coba lagi", dan pesan batas pemakaian
    - Terapkan Design System: `LargeTitle`, gelembung chat pada `SoftCard`, kolom masukan menempel di atas bilah bawah `GlassBar`, `Skeleton` pada riwayat saat memuat, tanpa `QuickAddFab`
    - _Requirements: 12.1, 12.5, 12.6, 16.3, 15.7, 17.8, 17.9, 17.10_

  - [~] 12.12 Halaman Wawasan
    - Riwayat Wawasan_Mingguan dengan ringkasan, Kategori terbesar, dan saran
    - Terapkan Design System: `LargeTitle`, setiap Wawasan pada `SoftCard`, dan `Skeleton` saat memuat
    - _Requirements: 13.2, 13.5, 15.7, 17.7, 17.9, 17.10_

  - [~] 12.13 Halaman Notifikasi dan Pengaturan
    - Daftar terbaru, tandai dibaca saat dibuka, preferensi jenis Notifikasi, dan izin push web yang menyimpan `PushSubscription`
    - Terapkan Design System: `LargeTitle`, item Notifikasi pada `SoftCard` dengan penanda belum dibaca berupa titik dan teks (tidak hanya warna), pengaturan jenis Notifikasi dan izin push pada `BottomSheet`, serta `Skeleton`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 15.7, 17.3, 17.9, 17.10_

  - [~] 12.14 Rangkai rute dan pemecahan kode
    - Hubungkan semua halaman ke router, `React.lazy` untuk Laporan dan Asisten, serta pecah kode per rute
    - Pasang transisi halaman lewat `navigateWithTransition` pada semua navigasi antar rute, prefetch saat idle untuk chunk `BottomSheet` formulir Transaksi agar terbuka dalam 300 ms, dan pastikan `QuickAddFab` hanya tampil di Beranda, Transaksi, dan Laporan
    - _Requirements: 15.6, 15.7, 17.1, 17.2, 17.5_

  - [~] 12.15 Tulis uji UI contoh
    - Keadaan kosong Laporan, tabel alternatif grafik, alur pratinjau bahasa alami dan struk, disclaimer chat, timeout 30 detik dengan fake timer, dan ekspor tanpa data
    - Tambahkan uji contoh Design System pada halaman: `Skeleton` tampil saat query `pending`, `QuickAddFab` hanya pada tiga halaman yang ditentukan, dan Lembar_Bawah menutup lewat scrim, tombol Tutup, dan `Escape`
    - _Requirements: 8.4, 8.5, 10.3, 10.4, 11.2, 11.6, 12.5, 12.6, 14.4, 17.1, 17.4, 17.10_

  - [~] 12.16 Tulis uji aksesibilitas dan tata letak
    - Pemeriksaan axe untuk label formulir dan kontras, serta tata letak 320 px sampai 480 px tanpa gulir horizontal
    - Sertakan pemeriksaan axe untuk kontras teks pada `GlassBar` dan `SoftCard` di DOM nyata, serta target sentuh 44 x 44 px pada `QuickAddFab` dan tombol Tutup `BottomSheet`
    - _Requirements: 15.2, 15.4, 15.5, 17.13, 18.8, 18.9_

- [ ] 13. PWA
  - [~] 13.1 Konfigurasi `vite-plugin-pwa`
    - Manifest bahasa Indonesia, ikon, cache aset oleh service worker, dan penangan push yang menampilkan Notifikasi
    - _Requirements: 9.4, 15.6_

  - [~] 13.2 Siapkan Lighthouse CI
    - Konfigurasi throttling 4G dan ambang interaktif pertama kurang dari 3 detik
    - _Requirements: 15.6_

- [ ] 14. Skrip verifikasi Bedrock
  - [~] 14.1 Buat `scripts/verify-bedrock.ts`
    - Cek `GetFoundationModelAvailability`, daftar profil inferensi dari `ap-southeast-3`, dan panggilan Converse nyata untuk kandidat C1, C2, C3
    - Cetak tabel hasil dan keluar dengan kode 0 hanya bila minimal satu kandidat dapat dipanggil
    - _Requirements: 16.1, 16.5_

  - [~] 14.2 Hubungkan skrip ke build
    - Tambah skrip `verify:bedrock` pada `package.json` dan langkah pra-deploy produksi pada `amplify.yml`
    - _Requirements: 16.1, 16.5_

- [~] 15. Checkpoint - Backend, domain, dan frontend dasar lulus uji
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Repositori Git dan pemindaian rahasia
  - [-] 16.1 Siapkan repositori dan dorong cabang fitur pertama
    - Buat `.gitignore` yang mengecualikan `node_modules/`, `dist/`, `.amplify/`, `amplify_outputs.json`, `.env`, `.env.*` (kecuali `.env.example`), `*.pem`, `*.key`, berkas kredensial AWS, `coverage/`, dan keluaran uji
    - Jalankan `git init` bila belum ada, lalu `git remote add origin https://github.com/josephmichaelp/arto.git` (URL polos tanpa userinfo; bila `origin` sudah ada, periksa dengan `git remote -v` dan perbaiki dengan `git remote set-url`)
    - Buat cabang fitur (misalnya `feature/arto-expense-tracker`), komit berkas dengan menambahkan berkas spesifik (bukan `git add .` buta), lalu `git push -u origin feature/arto-expense-tracker`. Jangan mendorong langsung ke `main`
    - Autentikasi dilakukan pengguna secara interaktif lewat `gh auth login` atau Git Credential Manager. NEVER menanamkan token, kata sandi, atau kredensial apa pun di berkas, URL remote, skrip, variabel lingkungan yang dikomit, maupun riwayat git
    - Verifikasi bahwa `git remote -v` tidak memuat `@` atau token, dan bahwa tidak ada berkas rahasia yang ter-stage sebelum komit
    - _Requirements: 1.6, 16.2_

  - [~] 16.2 Tambahkan pemindaian rahasia dan alur CI dasar
    - Buat `.github/workflows/ci.yml` dengan langkah instal, `vitest --run`, dan pemindaian rahasia memakai gitleaks (misalnya `gitleaks/gitleaks-action` dengan versi dipin dan `fetch-depth: 0`) pada setiap push dan pull request
    - Buat `.gitleaks.toml` yang memperluas aturan bawaan, dengan allowlist sempit hanya untuk `.env.example` dan data uji palsu yang jelas
    - Tambahkan langkah yang gagal bila URL remote atau berkas terlacak memuat pola kredensial tertanam (misalnya `https://<token>@github.com`)
    - Dokumentasikan di `README` singkat cara `gh auth login` atau Git Credential Manager, dan larangan menyimpan token di repositori
    - _Requirements: 1.6, 16.2_

- [ ] 17. Token tema, pembuat CSS, dan Latar_Gradien
  - [x] 17.1 Buat `src/theme/tokens.ts`
    - Definisikan `brand` (oat `#F1EEDB`, biru `#005DAC`, merah muda `#F2B8C6`), `derived` (`ink`, `inkMuted`, `card`, `onBlue`, `pinkStrong`, `blueDeep`), `glass` (`alpha`, `alphaFallback`), `radius`, `hit`, nilai mesh Latar_Gradien, dan `TEXT_SURFACE_PAIRS` (daftar pasangan teks dan latar untuk Properti 28) sesuai bagian Design System
    - Tandai dengan komentar jelas bahwa ketiga nilai Warna_Merek adalah pendekatan Pantone (Oat P 3-9 C, Biru P 104-8 C pendekatan uncoated, Merah_Muda P 73-7 C placeholder) dan MENUNGGU KONFIRMASI PEMILIK sebelum dikunci
    - _Requirements: 18.5, 18.6, 17.9_

  - [~] 17.2 Buat `scripts/generate-theme-css.ts` dan `src/theme/tokens.css`
    - Ekspor `generateCssVariables(tokens)` yang menghasilkan satu variabel CSS per token warna dan radius (termasuk tepat satu variabel untuk setiap Warna_Merek) dan fungsi pem-parse sederhana untuk uji
    - Skrip menulis `src/theme/tokens.css`, mendukung mode `--check` yang gagal bila berkas tidak sinkron dengan `tokens.ts`, dan ditambahkan sebagai skrip `generate:theme` dan `check:theme` pada `package.json`
    - _Requirements: 18.5, 18.6_

  - [~] 17.3 Buat `src/theme/global.css` dengan Latar_Gradien dan permukaan
    - Latar mesh gradien Oat/Biru/Merah_Muda pada `#app-bg` (`position: fixed`, `z-index: -1`, bukan `background-attachment: fixed`), kelas `.soft-card` (radius >= 16 px), dan `.glass` dengan fallback solid lalu `@supports` untuk `backdrop-filter`/`-webkit-backdrop-filter`
    - Aturan bahwa teks tidak pernah diletakkan langsung di atas gradien, variabel `--dur-*` dan `--ease-*`, serta penimpaan `@media (prefers-reduced-motion: reduce)`
    - Nilai gradien adalah pendekatan dan ditandai menunggu konfirmasi pemilik
    - _Requirements: 17.9, 17.11, 17.12, 18.7, 18.8_

  - [~] 17.4 Tulis uji properti variabel CSS
    - **Property 33: Variabel CSS sama dengan token**
    - Sertakan uji contoh bahwa `tokens.css` yang dikomit sinkron dengan hasil `generateCssVariables`
    - **Validates: Requirements 18.5, 18.6**

- [ ] 18. Domain murni Design System
  - [x] 18.1 Implementasi `shared/domain/contrast.ts`
    - `hexToRgb`, `relativeLuminance`, `contrastRatio`, `compositeOver`, `MIN_TEXT_CONTRAST`, dan `meetsTextContrast` dengan rumus WCAG 2.x
    - _Requirements: 17.12, 17.13, 18.9_

  - [~] 18.2 Tulis uji properti kebenaran helper kontras
    - **Property 29: Kebenaran helper rasio kontras**
    - **Validates: Requirements 17.13, 18.9**

  - [~] 18.3 Tulis uji properti kontras token
    - **Property 28: Semua pasangan teks dan latar pada token memenuhi kontras**
    - **Validates: Requirements 17.13, 18.6, 18.9**

  - [~] 18.4 Tulis uji properti kontras Permukaan_Kaca
    - **Property 30: Permukaan_Kaca menjaga kontras pada latar apa pun**
    - **Validates: Requirements 17.12, 17.13, 18.8**

  - [x] 18.5 Implementasi `shared/domain/motion.ts`
    - `MotionSpec`, `DURATION_BOUNDS`, `REDUCED_MAX_MS`, `resolveMotion`, dan token durasi/kurva bawaan (micro 180, page 300/200, sheet buka 280/tutup 220)
    - _Requirements: 17.2, 17.4, 17.5, 17.6, 17.11_

  - [~] 18.6 Tulis uji properti batas durasi gerak
    - **Property 31: Durasi gerak berada dalam batas kategori**
    - **Validates: Requirements 17.2, 17.4, 17.5, 17.6**

  - [~] 18.7 Tulis uji properti Gerak_Berkurang
    - **Property 32: Gerak_Berkurang menggantikan gerak dengan pudar atau instan**
    - **Validates: Requirements 17.11**

  - [-] 18.8 Implementasi `shared/domain/sheet.ts`
    - `DISMISS_RATIO`, `DISMISS_VELOCITY`, dan `shouldDismissSheet(dragY, sheetHeight, velocityPxPerMs)`
    - _Requirements: 17.4_

  - [~] 18.9 Tulis uji properti keputusan menutup Lembar_Bawah
    - **Property 34: Keputusan menutup Lembar_Bawah**
    - **Validates: Requirements 17.4**

- [ ] 19. Tumpukan font tanpa berkas SF
  - [~] 19.1 Terapkan tumpukan font dan Inter lewat `@fontsource`
    - Pasang `@fontsource-variable/inter` dengan versi dipin, impor subset `latin` dengan `font-display: swap` di `src/theme/fonts.ts`
    - Setel `--font-ui` pada `global.css` ke `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "SF Pro Rounded", "Inter", system-ui, sans-serif` dengan `font-feature-settings: "tnum" 1`, dan skala tipografi 34/22/17/13
    - Jangan menambahkan `@font-face` atau berkas font SF apa pun
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 15.6_

  - [~] 19.2 Buat penjaga CI `scripts/check-no-sf-fonts.ts`
    - Gagal bila ada berkas `*.woff|woff2|ttf|otf` bernama memuat "SF" atau "SFPro", `@font-face` dengan `family` berawalan "SF", atau paket font SF di `package.json`
    - Tambahkan skrip `check:fonts` pada `package.json` serta langkah `check:fonts` dan `check:theme` pada `.github/workflows/ci.yml`
    - _Requirements: 18.3, 18.4_

  - [~] 19.3 Tulis uji untuk penjaga font dan tumpukan font
    - Uji contoh: penjaga menolak berkas dan `@font-face` SF palsu pada direktori sementara serta meloloskan repositori bersih, dan `global.css` memuat urutan tumpukan font yang benar tanpa `@font-face` SF
    - _Requirements: 18.1, 18.2, 18.3_

- [ ] 20. Komponen UI dan gerak
  - [~] 20.1 Buat `useReducedMotion`, `motion.css`, dan `navigateWithTransition`
    - `src/motion/useReducedMotion.ts` membaca `matchMedia('(prefers-reduced-motion: reduce)')`, berlangganan perubahan, dan memasang `data-motion="reduced"` pada `<html>`
    - `src/motion/motion.css` untuk `--dur-*`, `--ease-*`, dan animasi masuk rute (pudar + geser 12 px, 300 ms) sebagai fallback, serta pudar 80 ms pada Gerak_Berkurang
    - `src/motion/navigateWithTransition.ts` memakai `document.startViewTransition` bila tersedia dan gerak tidak dikurangi, jika tidak memanggil `go()` langsung agar fallback CSS bekerja; sertakan pseudo-elemen `::view-transition-old/new(root)` 300 ms
    - _Requirements: 17.5, 17.6, 17.11_

  - [~] 20.2 Buat `GlassBar`, `SoftCard`, `LargeTitle`, dan `Skeleton`
    - `GlassBar` memakai kelas `.glass` (maksimal tiga lapisan blur per layar), `SoftCard` memakai `.soft-card` dengan radius >= 16 px
    - `LargeTitle` menghitung `p = clamp(scrollTop / 56, 0, 1)` dari sentinel `IntersectionObserver` atau pendengar gulir pasif, hanya menganimasikan `transform` dan `opacity`, dan beralih instan pada Gerak_Berkurang
    - `Skeleton` berradius sama dengan kartu final, `aria-busy="true"` pada wadah dan `role="status"` dengan teks tersembunyi "Memuat data", kilau 1400 ms yang berhenti pada Gerak_Berkurang
    - _Requirements: 17.7, 17.8, 17.9, 17.10, 17.11, 17.12, 17.14_

  - [~] 20.3 Buat `BottomSheet`
    - `role="dialog"`, `aria-modal="true"`, judul berlabel, fokus terkunci dan dikembalikan ke pemicu, `Escape` menutup, latar `inert`, status buka di URL query `?sheet=`
    - Tutup lewat scrim, tombol Tutup 44 px, atau geser ke bawah (Pointer Events + `transform: translateY`) memakai `shouldDismissSheet`; buka 280 ms dan tutup 220 ms lewat `resolveMotion`, tinggi mengikuti `visualViewport`
    - _Requirements: 17.2, 17.3, 17.4, 17.11, 15.4_

  - [~] 20.4 Buat `QuickAddFab`
    - Tombol bulat 56 px, `position: fixed`, `bottom: calc(env(safe-area-inset-bottom) + 72px)`, warna Biru dengan ikon `onBlue`, `aria-label="Tambah transaksi"`, hanya tampil di Beranda, Transaksi, dan Laporan, disembunyikan saat lembar terbuka
    - Membuka `BottomSheet` formulir ringkas dalam 300 ms (chunk di-prefetch saat idle), umpan balik tekan skala 0,96 selama 120 ms tanpa haptik
    - _Requirements: 17.1, 17.2, 17.6, 15.4_

  - [~] 20.5 Tulis uji komponen
    - Lembar menutup lewat scrim, tombol Tutup, `Escape`, dan geser melewati ambang; fokus kembali ke pemicu; `QuickAddFab` tampil hanya pada tiga halaman; `Skeleton` memuat `role="status"`; `SoftCard` berradius >= 16 px; `global.css` memuat blok `@supports` fallback `.glass`; `navigateWithTransition` memanggil `go()` langsung bila API tidak tersedia
    - _Requirements: 17.1, 17.4, 17.5, 17.9, 17.10, 17.12_

  - [~] 20.6 Tulis uji Playwright Gerak_Berkurang
    - Dengan `reducedMotion: 'reduce'`, pastikan tidak ada animasi `transform` aktif pada transisi halaman dan Lembar_Bawah serta durasi pudar paling lama 100 ms
    - Catatan: pengukuran 60 fps (17.14) dan View Transitions di Safari iOS dilakukan manual pada perangkat kelas menengah
    - _Requirements: 17.11, 17.14_

- [~] 21. Checkpoint akhir Design System dan repositori
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tugas bertanda `*` bersifat opsional dan dapat dilewati untuk MVP lebih cepat.
- Setiap tugas merujuk persyaratan spesifik untuk keterlacakan, dan setiap properti desain (1 sampai 34) memiliki sub-tugas uji sendiri.
- Hasil verifikasi akun (tabel "Hasil verifikasi akun" di dokumen desain) hanya dapat diisi setelah `verify-bedrock.ts` dijalankan dengan kredensial akun target. Tugas ini tidak mengisinya.
- Keputusan K-3 (setoran target tidak dihitung sebagai pengeluaran) dan K-5 (jendela tetap per jam) masih perlu dikonfirmasi pemilik.
- Bila pemilik memilih Opsi B (backend di `ap-southeast-3`), cukup ubah konfigurasi deploy. Logika AI tidak berubah karena `BEDROCK_REGION` dibaca dari lingkungan.
- Pemilik perlu mengonfirmasi nilai hex Pantone sebelum dikunci, terutama Merah_Muda (P 73-7 C) yang saat ini hanya placeholder `#F2B8C6` tanpa sumber hex andal. Oat `#F1EEDB` dan Biru `#005DAC` (dari varian uncoated P 104-8 U) juga hanya pendekatan layar. Gradien mesh pada `global.css` mengikuti nilai ini. Bila nilai berubah, jalankan `generate:theme` dan uji Properti 28 serta 30 akan gagal sampai warna turunan disesuaikan.
- Aturan keamanan repositori: remote `https://github.com/josephmichaelp/arto.git` harus berupa URL polos. Autentikasi memakai `gh auth login` atau Git Credential Manager. Token tidak boleh ada di berkas, URL remote, skrip, atau riwayat git. Gitleaks pada CI menjadi pengaman tambahan, bukan pengganti kehati-hatian.
- Tidak ada berkas font SF di repositori. Perangkat Apple memakai SF secara native lewat tumpukan font sistem, perangkat lain memakai Inter dari `@fontsource-variable/inter` (SIL OFL 1.1). Penjaga `check-no-sf-fonts` berjalan di CI.
- Pengukuran 60 fps (Requirement 17.14) dan perilaku View Transitions di Safari iOS tidak dapat dibuktikan lewat uji otomatis dan dilakukan manual.
- Langkah `git push` pertama memerlukan autentikasi interaktif oleh pemilik. Agen tidak boleh meminta atau menyimpan kredensial.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "16.1", "17.1", "18.1", "18.5", "18.8"] },
    { "id": 2, "tasks": ["2.2", "2.6", "3.1", "3.14", "3.17", "4.5", "4.7", "4.9", "6.1", "6.2", "6.3", "8.1", "16.2", "17.2", "18.2", "18.3", "18.4", "18.6", "18.7", "18.9"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "2.7", "3.2", "3.3", "3.4", "3.7", "3.9", "3.11", "3.15", "3.16", "3.18", "4.1", "4.6", "4.8", "4.10", "6.4", "7.1", "8.2", "8.3", "14.1", "17.3", "17.4", "20.1"] },
    { "id": 4, "tasks": ["3.5", "3.6", "3.8", "3.10", "3.12", "3.13", "4.2", "4.3", "4.4", "6.5", "6.6", "7.2", "8.4", "8.5", "8.6", "8.7", "14.2", "20.2", "20.3"] },
    { "id": 5, "tasks": ["6.7", "7.3", "7.4", "7.5", "8.8", "10.1", "10.3", "19.1", "20.4"] },
    { "id": 6, "tasks": ["7.6", "8.9", "8.10", "8.11", "10.2", "10.4", "12.1", "13.1", "19.2", "20.5"] },
    { "id": 7, "tasks": ["7.7", "7.8", "7.9", "12.2", "12.3", "19.3"] },
    { "id": 8, "tasks": ["12.4", "12.5", "12.6", "12.7", "12.9", "12.10", "12.11", "12.12", "12.13"] },
    { "id": 9, "tasks": ["12.8"] },
    { "id": 10, "tasks": ["12.14"] },
    { "id": 11, "tasks": ["12.15", "12.16", "13.2", "20.6"] }
  ]
}
```
