# Arto Expense Tracker

Pelacak pengeluaran pribadi berbasis TypeScript, React 18, dan AWS Amplify Gen2.

## Pengembangan

```bash
npm ci
npm run dev
```

Skrip lain yang tersedia: `npm run typecheck`, `npm test` (vitest), `npm run build`.

## Autentikasi Git

Repositori ini memakai remote HTTPS biasa (`https://github.com/josephmichaelp/arto.git`)
tanpa token atau kredensial apa pun tertanam di URL, berkas, atau riwayat commit.

Untuk push/pull, autentikasi secara interaktif memakai salah satu cara berikut:

- **GitHub CLI**: jalankan `gh auth login` sekali per mesin, lalu gunakan Git seperti biasa.
- **Git Credential Manager**: biarkan GCM menangani prompt login saat Git memerlukan kredensial.

**Jangan pernah** menyimpan token akses personal, kata sandi, atau kredensial lain di:

- berkas yang dikomit (termasuk `.env`, skrip, atau dokumen),
- URL remote Git (`git remote set-url` dengan format `https://<token>@github.com/...`),
- variabel lingkungan yang ikut dikomit, atau
- riwayat commit dalam bentuk apa pun.

## CI dan pemindaian rahasia

Setiap push dan pull request menjalankan `.github/workflows/ci.yml`, yang melakukan:

1. Instal dependensi (`npm ci`)
2. Pemeriksaan tipe (`npm run typecheck`)
3. Uji otomatis (`npm test`)
4. Build (`npm run build`)
5. Pemindaian rahasia dengan [gitleaks](https://github.com/gitleaks/gitleaks) (konfigurasi di `.gitleaks.toml`)
6. Pemeriksaan tambahan yang menolak URL remote atau berkas terlacak yang memuat kredensial tertanam (misalnya `https://<token>@github.com`)
