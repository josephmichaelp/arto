/**
 * Tumpukan font Arto (Req 18.1, 18.2, 18.3, 18.4, 15.6).
 *
 * Perangkat Apple memakai San Francisco (SF) secara native lewat tumpukan
 * font sistem pada `--font-ui` (lihat `global.css`). Perangkat non-Apple
 * memakai Inter yang di-host sendiri dari `@fontsource-variable/inter`
 * (SIL OFL 1.1), bukan berkas font SF apa pun.
 *
 * Impor di bawah hanya memuat subset `latin` dari paket (lihat `fonts.css`),
 * dengan `font-display: swap` dan `unicode-range`, sehingga peramban hanya
 * mengunduh woff2 latin saat menampilkan teks latin (Bahasa Indonesia).
 * Keluarga didaftarkan sebagai `Inter` dan dirujuk pada `--font-ui`.
 *
 * Catatan: TIDAK ADA `@font-face` atau berkas font SF yang ditambahkan di
 * sini maupun di `fonts.css` (Req 18.3, 18.4). Penjaga CI
 * `check-no-sf-fonts` menegakkan aturan ini.
 */
import './fonts.css';
