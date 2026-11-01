# Requirements Document

## Introduction

Arto adalah aplikasi web mobile (mobile-first) untuk mencatat pengeluaran dan pemasukan, merencanakan anggaran, serta mendapatkan bantuan AI dalam mengelola keuangan pribadi. Aplikasi dibangun dengan TypeScript di atas AWS Amplify Gen2 (Cognito, AppSync/DynamoDB, S3, Lambda) dan memakai Amazon Bedrock model Nova Lite di region Asia Pasifik (Jakarta, ap-southeast-3). Seluruh antarmuka dan respons AI berbahasa Indonesia, mata uang hanya Rupiah (IDR) dengan format "Rp 1.000.000". Aplikasi untuk penggunaan pribadi: satu pengguna per akun, data bersifat privat per pemilik, tanpa fitur berbagi atau keluarga.

Ketersediaan dan akses model Nova Lite di ap-southeast-3 harus diverifikasi pada fase desain.

Repositori proyek: https://github.com/josephmichaelp/arto.git (hanya URL repositori; token atau kredensial apa pun tidak boleh dicantumkan pada berkas spesifikasi, kode, maupun konfigurasi yang masuk ke repositori).

## Glossary

- **Arto**: Aplikasi web mobile pelacak keuangan yang dijelaskan dalam dokumen ini.
- **Sistem**: Keseluruhan Arto, mencakup frontend, backend Amplify, dan layanan AI.
- **Pengguna**: Pemilik akun yang telah terautentikasi.
- **Autentikasi**: Modul login berbasis email menggunakan Amazon Cognito.
- **Transaksi**: Catatan pengeluaran atau pemasukan dengan nominal, tanggal, kategori, dan dompet.
- **Dompet**: Akun keuangan milik Pengguna (misalnya tunai, rekening bank, e-wallet) dengan saldo sendiri.
- **Kategori**: Label pengelompokan Transaksi, berupa Kategori bawaan atau Kategori kustom.
- **Anggaran**: Batas pengeluaran per Kategori untuk satu periode bulanan.
- **Transaksi_Berulang**: Aturan Transaksi yang dibuat otomatis secara periodik (tagihan atau langganan).
- **Target_Tabungan**: Sasaran menabung dengan nominal target, tenggat, dan progres.
- **Laporan**: Ringkasan dan grafik pemasukan serta pengeluaran untuk rentang waktu tertentu.
- **Notifikasi**: Pesan peringatan di dalam aplikasi kepada Pengguna.
- **Layanan_AI**: Komponen yang memanggil Amazon Bedrock model Nova Lite.
- **Asisten_Keuangan**: Fitur tanya-jawab berbasis chat atas data keuangan Pengguna.
- **Input_Bahasa_Alami**: Fitur membuat Transaksi dari kalimat bebas, misalnya "makan siang 35rb".
- **Pemindai_Struk**: Fitur ekstraksi data Transaksi dari foto struk.
- **Wawasan_Mingguan**: Ringkasan dan saran penghematan yang dibuat AI setiap minggu.
- **Format_Rupiah**: Penulisan nominal dengan awalan "Rp", spasi, dan pemisah ribuan titik, misalnya "Rp 1.000.000".
- **Zona_Waktu_Pengguna**: Zona waktu Asia/Jakarta (WIB) yang dipakai untuk batas hari dan bulan.
- **Lembar_Bawah**: Panel antarmuka yang muncul dari tepi bawah layar (bottom sheet) untuk menampung formulir atau pilihan tanpa berpindah halaman.
- **Aksi_Cepat_Tambah**: Tombol aksi utama yang selalu terjangkau ibu jari untuk membuka pencatatan Transaksi baru.
- **Judul_Besar**: Gaya judul halaman berukuran besar (large title) yang mengecil saat halaman digulir.
- **Permukaan_Kaca**: Permukaan semi-transparan dengan efek blur latar (glass/blur) yang dipakai pada bilah navigasi dan panel.
- **Kartu_Lembut**: Kartu konten berlatar solid atau semi-opak dengan sudut membulat besar yang menjadi wadah teks di atas Latar_Gradien.
- **Skeleton**: Kerangka placeholder yang tampil selama data dimuat.
- **Gerak_Berkurang**: Preferensi sistem pengguna "prefers-reduced-motion: reduce".
- **Tumpukan_Font_Sistem**: Daftar font CSS "-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "SF Pro Rounded"" diikuti font cadangan.
- **Font_Cadangan**: Font yang dipakai pada perangkat non-Apple, yaitu Inter atau system-ui.
- **Warna_Merek**: Tiga warna merek Arto: Oat (Pantone P 3-9 C), Biru (Pantone P 104-8 C), dan Merah_Muda (Pantone P 73-7 C).
- **Latar_Gradien**: Latar aplikasi berupa gradien lembut yang memadukan ketiga Warna_Merek.

## Requirements

### Requirement 1: Autentikasi dan Privasi Data

**User Story:** Sebagai pengguna, saya ingin mendaftar dan masuk memakai email, sehingga data keuangan saya aman dan hanya bisa diakses oleh saya.

#### Acceptance Criteria

1. WHEN calon Pengguna mengirim email valid dan kata sandi yang memenuhi kebijakan Cognito, THE Autentikasi SHALL membuat akun dan mengirim kode verifikasi ke email tersebut.
2. WHEN Pengguna memasukkan kode verifikasi yang benar, THE Autentikasi SHALL mengaktifkan akun.
3. WHEN Pengguna mengirim kredensial yang benar, THE Autentikasi SHALL membuat sesi dan membuka halaman beranda.
4. IF Pengguna mengirim kredensial yang salah, THEN THE Autentikasi SHALL menampilkan pesan galat berbahasa Indonesia tanpa mengungkap apakah email terdaftar.
5. WHEN Pengguna meminta atur ulang kata sandi, THE Autentikasi SHALL mengirim kode atur ulang ke email terdaftar.
6. THE Sistem SHALL membatasi akses baca dan tulis setiap data Pengguna hanya untuk pemilik data tersebut.
7. WHILE Pengguna belum terautentikasi, THE Sistem SHALL mengarahkan semua permintaan halaman data ke halaman masuk.
8. THE Sistem SHALL mengizinkan banyak akun terdaftar secara independen tanpa fitur berbagi data antar akun.

### Requirement 2: Pencatatan Transaksi

**User Story:** Sebagai pengguna, saya ingin mencatat pengeluaran dan pemasukan, sehingga saya tahu ke mana uang saya pergi.

#### Acceptance Criteria

1. WHEN Pengguna menyimpan Transaksi dengan jenis, nominal lebih dari 0, tanggal, Kategori, dan Dompet, THE Sistem SHALL menyimpan Transaksi tersebut dan memperbarui saldo Dompet terkait.
2. WHEN Pengguna mengubah Transaksi, THE Sistem SHALL menyimpan perubahan dan menghitung ulang saldo Dompet yang terdampak.
3. WHEN Pengguna menghapus Transaksi setelah konfirmasi, THE Sistem SHALL menghapus Transaksi dan mengembalikan saldo Dompet terkait.
4. IF nominal Transaksi kosong, nol, negatif, atau bukan angka, THEN THE Sistem SHALL menolak penyimpanan dan menampilkan pesan galat berbahasa Indonesia pada kolom nominal.
5. THE Sistem SHALL menampilkan daftar Transaksi terurut dari tanggal terbaru dengan pemuatan bertahap 20 item per halaman.
6. WHEN Pengguna memasukkan kata kunci, memilih Kategori, Dompet, jenis, atau rentang tanggal, THE Sistem SHALL menampilkan hanya Transaksi yang cocok dengan seluruh filter aktif.
7. THE Sistem SHALL menampilkan setiap nominal dalam Format_Rupiah.
8. THE Sistem SHALL menyimpan nominal sebagai bilangan bulat Rupiah tanpa pecahan.

### Requirement 3: Manajemen Kategori

**User Story:** Sebagai pengguna, saya ingin mengelola kategori, sehingga pengelompokan transaksi sesuai kebiasaan saya.

#### Acceptance Criteria

1. WHEN Pengguna baru menyelesaikan pendaftaran, THE Sistem SHALL menyediakan Kategori bawaan berbahasa Indonesia untuk pengeluaran dan pemasukan.
2. WHEN Pengguna membuat Kategori kustom dengan nama unik dan jenis, THE Sistem SHALL menyimpan Kategori tersebut.
3. IF nama Kategori sudah ada untuk jenis yang sama milik Pengguna, THEN THE Sistem SHALL menolak penyimpanan dan menampilkan pesan galat berbahasa Indonesia.
4. WHEN Pengguna mengubah nama Kategori, THE Sistem SHALL menampilkan nama baru pada semua Transaksi dan Anggaran terkait.
5. IF Pengguna menghapus Kategori yang memiliki Transaksi, THEN THE Sistem SHALL meminta Pengguna memilih Kategori pengganti sebelum penghapusan dijalankan.

### Requirement 4: Multi-Dompet

**User Story:** Sebagai pengguna, saya ingin memiliki beberapa dompet, sehingga saldo tunai, bank, dan e-wallet terpisah.

#### Acceptance Criteria

1. WHEN Pengguna membuat Dompet dengan nama unik dan saldo awal bilangan bulat tidak negatif, THE Sistem SHALL menyimpan Dompet tersebut.
2. THE Sistem SHALL menampilkan saldo setiap Dompet dan total saldo seluruh Dompet dalam Format_Rupiah.
3. WHEN Pengguna memindahkan dana antar dua Dompet berbeda dengan nominal lebih dari 0, THE Sistem SHALL mengurangi saldo Dompet asal dan menambah saldo Dompet tujuan sebesar nominal yang sama.
4. IF nominal pemindahan melebihi saldo Dompet asal, THEN THE Sistem SHALL menolak pemindahan dan menampilkan pesan galat berbahasa Indonesia.
5. IF Pengguna menghapus Dompet yang memiliki Transaksi, THEN THE Sistem SHALL meminta Pengguna memindahkan Transaksi ke Dompet lain sebelum penghapusan dijalankan.
6. THE Sistem SHALL mengecualikan pemindahan antar Dompet dari total pemasukan dan pengeluaran pada Laporan.

### Requirement 5: Perencanaan Anggaran

**User Story:** Sebagai pengguna, saya ingin menetapkan anggaran bulanan, sehingga pengeluaran saya terkendali.

#### Acceptance Criteria

1. WHEN Pengguna menetapkan Anggaran dengan Kategori pengeluaran, bulan, dan nominal lebih dari 0, THE Sistem SHALL menyimpan Anggaran tersebut.
2. THE Sistem SHALL menghitung realisasi Anggaran sebagai jumlah pengeluaran pada Kategori tersebut dalam bulan berjalan menurut Zona_Waktu_Pengguna.
3. THE Sistem SHALL menampilkan sisa Anggaran dan persentase terpakai untuk setiap Anggaran.
4. WHEN realisasi suatu Anggaran mencapai 80 persen dari nominal Anggaran, THE Sistem SHALL membuat satu Notifikasi peringatan untuk Anggaran tersebut pada bulan itu.
5. WHEN realisasi suatu Anggaran melampaui 100 persen dari nominal Anggaran, THE Sistem SHALL membuat satu Notifikasi pelampauan untuk Anggaran tersebut pada bulan itu.
6. WHEN Pengguna meminta salin Anggaran bulan sebelumnya, THE Sistem SHALL membuat Anggaran bulan berjalan dengan Kategori dan nominal yang sama.

### Requirement 6: Transaksi Berulang

**User Story:** Sebagai pengguna, saya ingin transaksi rutin tercatat otomatis, sehingga tagihan dan langganan tidak terlewat.

#### Acceptance Criteria

1. WHEN Pengguna membuat Transaksi_Berulang dengan nominal, Kategori, Dompet, frekuensi (harian, mingguan, bulanan, atau tahunan), dan tanggal mulai, THE Sistem SHALL menyimpan aturan tersebut.
2. WHEN tanggal jatuh tempo Transaksi_Berulang tiba menurut Zona_Waktu_Pengguna, THE Sistem SHALL membuat satu Transaksi sesuai aturan tersebut.
3. IF tanggal jatuh tempo bulanan tidak ada pada bulan berjalan, THEN THE Sistem SHALL membuat Transaksi pada hari terakhir bulan tersebut.
4. WHEN Pengguna menjeda atau menghapus Transaksi_Berulang, THE Sistem SHALL berhenti membuat Transaksi baru dari aturan tersebut.
5. WHEN jatuh tempo Transaksi_Berulang tinggal 3 hari, THE Sistem SHALL membuat satu Notifikasi pengingat untuk jatuh tempo tersebut.
6. THE Sistem SHALL membuat tepat satu Transaksi untuk setiap jatuh tempo, walaupun proses penjadwalan dijalankan lebih dari sekali.

### Requirement 7: Target Tabungan

**User Story:** Sebagai pengguna, saya ingin menetapkan target tabungan, sehingga saya termotivasi mencapai tujuan finansial.

#### Acceptance Criteria

1. WHEN Pengguna membuat Target_Tabungan dengan nama, nominal target lebih dari 0, dan tenggat opsional, THE Sistem SHALL menyimpan Target_Tabungan tersebut.
2. WHEN Pengguna menambah setoran ke Target_Tabungan dari suatu Dompet, THE Sistem SHALL menambah progres Target_Tabungan dan mengurangi saldo Dompet sebesar nominal setoran.
3. THE Sistem SHALL menampilkan progres Target_Tabungan sebagai nominal terkumpul dan persentase terhadap target.
4. WHEN progres Target_Tabungan mencapai 100 persen, THE Sistem SHALL menandai Target_Tabungan sebagai tercapai dan membuat satu Notifikasi.
5. WHERE Target_Tabungan memiliki tenggat, THE Sistem SHALL menampilkan setoran bulanan yang diperlukan untuk mencapai target tepat waktu.
6. IF nominal setoran melebihi saldo Dompet, THEN THE Sistem SHALL menolak setoran dan menampilkan pesan galat berbahasa Indonesia.

### Requirement 8: Laporan dan Grafik

**User Story:** Sebagai pengguna, saya ingin melihat laporan dan grafik, sehingga saya memahami pola keuangan saya.

#### Acceptance Criteria

1. WHEN Pengguna memilih rentang waktu, THE Sistem SHALL menampilkan total pemasukan, total pengeluaran, dan selisih untuk rentang tersebut.
2. THE Sistem SHALL menampilkan grafik pengeluaran per Kategori dalam rentang waktu terpilih.
3. THE Sistem SHALL menampilkan grafik tren pemasukan dan pengeluaran per hari, minggu, atau bulan sesuai pilihan Pengguna.
4. WHEN rentang waktu terpilih tidak memiliki Transaksi, THE Sistem SHALL menampilkan keadaan kosong berbahasa Indonesia.
5. THE Sistem SHALL menyediakan alternatif teks berupa tabel angka untuk setiap grafik.

### Requirement 9: Notifikasi

**User Story:** Sebagai pengguna, saya ingin menerima notifikasi, sehingga saya cepat mengetahui hal penting terkait keuangan.

#### Acceptance Criteria

1. WHEN Notifikasi dibuat, THE Sistem SHALL menyimpannya dan menampilkan penanda jumlah Notifikasi belum dibaca pada navigasi.
2. WHEN Pengguna membuka Notifikasi, THE Sistem SHALL menandainya sebagai sudah dibaca.
3. THE Sistem SHALL menampilkan daftar Notifikasi terurut dari yang terbaru.
4. WHERE Pengguna mengizinkan notifikasi peramban, THE Sistem SHALL mengirim notifikasi push web untuk setiap Notifikasi baru.
5. WHEN Pengguna menonaktifkan suatu jenis Notifikasi di pengaturan, THE Sistem SHALL berhenti membuat Notifikasi jenis tersebut.

### Requirement 10: Input Bahasa Alami

**User Story:** Sebagai pengguna, saya ingin mencatat transaksi dengan kalimat biasa, sehingga pencatatan cepat.

#### Acceptance Criteria

1. WHEN Pengguna mengirim kalimat berbahasa Indonesia melalui Input_Bahasa_Alami, THE Layanan_AI SHALL mengekstrak jenis, nominal, tanggal, dan Kategori dari kalimat tersebut.
2. THE Layanan_AI SHALL menafsirkan singkatan nominal seperti "35rb" sebagai 35.000 dan "1,5jt" sebagai 1.500.000.
3. WHEN ekstraksi berhasil, THE Sistem SHALL menampilkan hasil sebagai pratinjau yang dapat diedit sebelum disimpan.
4. WHEN Pengguna mengonfirmasi pratinjau, THE Sistem SHALL menyimpan Transaksi dari data pratinjau.
5. IF kalimat tidak memuat nominal yang dapat dikenali, THEN THE Sistem SHALL meminta Pengguna melengkapi nominal tanpa menyimpan Transaksi.
6. WHEN kalimat tidak menyebut tanggal, THE Layanan_AI SHALL memakai tanggal hari ini menurut Zona_Waktu_Pengguna.
7. THE Layanan_AI SHALL memilih Kategori hanya dari Kategori milik Pengguna.

### Requirement 11: Pemindaian Struk

**User Story:** Sebagai pengguna, saya ingin memindai struk, sehingga saya tidak perlu mengetik manual.

#### Acceptance Criteria

1. WHEN Pengguna mengunggah foto struk berformat JPEG atau PNG berukuran paling besar 5 MB, THE Pemindai_Struk SHALL mengekstrak total, tanggal, nama merchant, dan usulan Kategori.
2. WHEN ekstraksi selesai, THE Sistem SHALL menampilkan hasil sebagai pratinjau yang dapat diedit sebelum disimpan.
3. IF format atau ukuran file tidak memenuhi syarat, THEN THE Sistem SHALL menolak unggahan dan menampilkan pesan galat berbahasa Indonesia.
4. IF Pemindai_Struk tidak dapat mengenali total pada foto, THEN THE Sistem SHALL meminta Pengguna mengisi nominal secara manual.
5. THE Sistem SHALL menyimpan foto struk pada penyimpanan privat yang hanya dapat diakses oleh pemilik.
6. WHEN Pengguna menyimpan Transaksi dari pratinjau, THE Sistem SHALL menautkan foto struk ke Transaksi tersebut.

### Requirement 12: Asisten Keuangan AI

**User Story:** Sebagai pengguna, saya ingin bertanya tentang keuangan saya kepada asisten, sehingga saya mendapat jawaban dan saran dalam bahasa Indonesia.

#### Acceptance Criteria

1. WHEN Pengguna mengirim pertanyaan, THE Asisten_Keuangan SHALL menjawab dalam bahasa Indonesia berdasarkan data keuangan milik Pengguna tersebut.
2. THE Asisten_Keuangan SHALL menampilkan semua nominal pada jawaban dalam Format_Rupiah.
3. THE Asisten_Keuangan SHALL hanya menyertakan data milik Pengguna yang sedang terautentikasi dalam konteks permintaan ke Layanan_AI.
4. IF pertanyaan tidak berkaitan dengan keuangan pribadi, THEN THE Asisten_Keuangan SHALL menjelaskan bahwa cakupannya terbatas pada keuangan Pengguna.
5. IF Layanan_AI gagal merespons dalam 30 detik, THEN THE Sistem SHALL menampilkan pesan galat berbahasa Indonesia dan opsi coba lagi.
6. THE Asisten_Keuangan SHALL menyertakan pernyataan bahwa jawaban bersifat informasi umum dan bukan nasihat keuangan profesional pada tampilan chat.

### Requirement 13: Wawasan Mingguan

**User Story:** Sebagai pengguna, saya ingin wawasan mingguan otomatis, sehingga saya mendapat saran penghematan tanpa bertanya.

#### Acceptance Criteria

1. WHEN pekan berakhir menurut Zona_Waktu_Pengguna, THE Layanan_AI SHALL membuat Wawasan_Mingguan berbahasa Indonesia dari Transaksi dan Anggaran pekan tersebut.
2. THE Wawasan_Mingguan SHALL memuat ringkasan total pengeluaran, Kategori pengeluaran terbesar, dan paling sedikit satu saran penghematan.
3. WHEN Wawasan_Mingguan dibuat, THE Sistem SHALL membuat satu Notifikasi yang mengarah ke Wawasan_Mingguan tersebut.
4. IF Pengguna tidak memiliki Transaksi pada pekan tersebut, THEN THE Sistem SHALL melewati pembuatan Wawasan_Mingguan untuk pekan itu.
5. THE Sistem SHALL menyimpan Wawasan_Mingguan sebelumnya dan menampilkannya dalam daftar riwayat.

### Requirement 14: Ekspor Data

**User Story:** Sebagai pengguna, saya ingin mengekspor data, sehingga saya dapat menyimpan atau membagikannya sendiri.

#### Acceptance Criteria

1. WHEN Pengguna meminta ekspor CSV untuk rentang tanggal, THE Sistem SHALL menghasilkan berkas CSV berisi Transaksi pada rentang tersebut dengan kolom tanggal, jenis, Kategori, Dompet, nominal, dan catatan.
2. WHEN Pengguna meminta ekspor PDF untuk rentang tanggal, THE Sistem SHALL menghasilkan berkas PDF berisi ringkasan Laporan dan daftar Transaksi pada rentang tersebut.
3. THE Sistem SHALL menulis nominal pada berkas ekspor dalam Format_Rupiah pada PDF dan sebagai bilangan bulat tanpa pemisah pada CSV.
4. IF rentang tanggal tidak memiliki Transaksi, THEN THE Sistem SHALL menampilkan pesan bahwa tidak ada data untuk diekspor.
5. THE Sistem SHALL menyandikan berkas CSV dalam UTF-8.

### Requirement 15: Antarmuka Mobile Berbahasa Indonesia

**User Story:** Sebagai pengguna, saya ingin aplikasi nyaman dipakai di ponsel dan berbahasa Indonesia, sehingga mudah digunakan sehari-hari.

#### Acceptance Criteria

1. THE Sistem SHALL menampilkan seluruh teks antarmuka, pesan galat, dan keadaan kosong dalam bahasa Indonesia.
2. THE Sistem SHALL menyajikan tata letak yang dapat dipakai pada lebar layar 320 px hingga 480 px tanpa pengguliran horizontal.
3. THE Sistem SHALL menampilkan tanggal dalam format "17 Agustus 2025" menurut Zona_Waktu_Pengguna.
4. THE Sistem SHALL menyediakan target sentuh minimal 44 px x 44 px untuk kontrol interaktif.
5. THE Sistem SHALL menyediakan label teks untuk semua kontrol formulir dan kontras teks minimal 4,5:1 terhadap latar.
6. WHEN halaman dimuat pada jaringan seluler 4G, THE Sistem SHALL menampilkan konten interaktif pertama dalam 3 detik.
7. THE Sistem SHALL menerapkan persyaratan pengalaman antarmuka modern pada Requirement 17 serta persyaratan tipografi dan palet warna pada Requirement 18.

### Requirement 16: Integrasi AI yang Aman

**User Story:** Sebagai pemilik aplikasi, saya ingin integrasi AI yang aman dan terkendali, sehingga biaya dan privasi terjaga.

#### Acceptance Criteria

1. THE Layanan_AI SHALL memanggil Amazon Bedrock model Nova Lite pada region ap-southeast-3, atau pada profil inferensi yang tersedia untuk akun jika model tidak tersedia langsung di region tersebut.
2. THE Layanan_AI SHALL dipanggil hanya dari fungsi backend yang memverifikasi identitas Pengguna terautentikasi, bukan langsung dari peramban.
3. WHEN Pengguna terautentikasi mengirim lebih dari 30 permintaan AI dalam satu jam, THE Sistem SHALL menolak permintaan berikutnya dan menampilkan pesan batas pemakaian berbahasa Indonesia.
4. IF panggilan ke Bedrock gagal, THEN THE Sistem SHALL mencatat galat tanpa memuat isi data keuangan Pengguna pada log.
5. WHEN fase desain dijalankan, THE tim pengembang SHALL memverifikasi ketersediaan Nova Lite dan akses model pada ap-southeast-3 serta mendokumentasikan hasilnya pada dokumen desain.

### Requirement 17: Pengalaman Antarmuka Modern yang Mudah dan Halus

**User Story:** Sebagai pengguna, saya ingin antarmuka yang mudah dipakai, halus, dan mengikuti tren desain mobile 2026, sehingga mencatat keuangan terasa nyaman dan cepat.

#### Acceptance Criteria

1. THE Sistem SHALL menampilkan Aksi_Cepat_Tambah pada halaman beranda, daftar Transaksi, dan Laporan pada area yang terjangkau ibu jari di bagian bawah layar.
2. WHEN Pengguna mengetuk Aksi_Cepat_Tambah, THE Sistem SHALL membuka formulir Transaksi pada Lembar_Bawah dalam 300 ms tanpa berpindah halaman.
3. THE Sistem SHALL menampilkan formulir ringkas, pemilih Kategori, pemilih Dompet, dan konfirmasi hapus pada Lembar_Bawah.
4. WHEN Pengguna menggeser Lembar_Bawah ke bawah atau mengetuk area di luar Lembar_Bawah, THE Sistem SHALL menutup Lembar_Bawah dengan animasi.
5. WHEN Pengguna berpindah antar halaman, THE Sistem SHALL memutar transisi halaman berdurasi antara 150 ms dan 400 ms.
6. WHEN Pengguna menyelesaikan aksi seperti menyimpan Transaksi, menyalakan pilihan, atau mengetuk tombol, THE Sistem SHALL memberi umpan balik gerak halus (misalnya skala atau pantulan singkat) berdurasi paling lama 250 ms sebagai pengganti getaran haptik.
7. THE Sistem SHALL menampilkan Judul_Besar pada halaman utama dan mengecilkannya menjadi judul ringkas saat halaman digulir.
8. THE Sistem SHALL menampilkan bilah navigasi bawah dan bilah atas menggunakan Permukaan_Kaca.
9. THE Sistem SHALL menampilkan konten Transaksi, Anggaran, Target_Tabungan, dan Laporan pada Kartu_Lembut dengan radius sudut paling sedikit 16 px.
10. WHILE data sedang dimuat, THE Sistem SHALL menampilkan Skeleton pada area konten yang menunggu data.
11. WHILE Gerak_Berkurang aktif, THE Sistem SHALL mengganti animasi gerak, transisi geser, dan efek pantulan dengan perubahan instan atau pudar (fade) berdurasi paling lama 100 ms.
12. WHERE peramban tidak mendukung efek blur latar, THE Sistem SHALL menampilkan Permukaan_Kaca sebagai permukaan solid semi-opak dengan kontras teks tetap minimal 4,5:1.
13. THE Sistem SHALL menjaga rasio kontras teks minimal 4,5:1 terhadap latar pada semua komponen, termasuk teks pada Permukaan_Kaca dan Kartu_Lembut.
14. THE Sistem SHALL mempertahankan animasi pada kecepatan render 60 frame per detik pada ponsel kelas menengah dengan jeda frame lebih dari 50 ms terjadi kurang dari 1 persen waktu animasi.

### Requirement 18: Tipografi dan Palet Warna Merek

**User Story:** Sebagai pemilik aplikasi, saya ingin tipografi keluarga SF Apple dan palet warna Pantone merek Arto, sehingga tampilan konsisten, indah, dan sesuai lisensi.

#### Acceptance Criteria

1. THE Sistem SHALL menetapkan font antarmuka menggunakan Tumpukan_Font_Sistem agar keluarga font SF (SF Pro Text, SF Pro Display, dan SF Pro Rounded) tampil secara native pada perangkat Apple.
2. WHERE perangkat bukan perangkat Apple, THE Sistem SHALL memakai Font_Cadangan (Inter atau system-ui) setelah Tumpukan_Font_Sistem.
3. THE Sistem SHALL tidak menyertakan, menyimpan, atau menyajikan berkas font SF (misalnya WOFF, WOFF2, TTF, atau OTF) dari server milik tim maupun dari repositori proyek, karena lisensi Apple melarang pendistribusian ulang atau penyematan font SF di web.
4. WHERE Font_Cadangan berupa Inter, THE Sistem SHALL menyajikan Inter hanya dari sumber yang berlisensi mengizinkan penyajian ulang (Inter berlisensi SIL Open Font License).
5. THE Sistem SHALL memakai tiga Warna_Merek sebagai warna merek utama: Oat (Pantone P 3-9 C), Biru (Pantone P 104-8 C), dan Merah_Muda (Pantone P 73-7 C).
6. THE Sistem SHALL mendefinisikan setiap Warna_Merek sebagai token warna sRGB (nilai hex) pada satu berkas konfigurasi tema.
7. THE Sistem SHALL menampilkan Latar_Gradien yang memadukan Oat, Biru, dan Merah_Muda secara lembut sebagai latar aplikasi.
8. THE Sistem SHALL menampilkan semua teks di atas Latar_Gradien pada Kartu_Lembut atau Permukaan_Kaca solid/semi-opak sehingga rasio kontras teks minimal 4,5:1.
9. WHEN token warna atau gradien diubah, THE Sistem SHALL tetap memenuhi rasio kontras teks minimal 4,5:1 pada semua kombinasi teks dan latar yang dipakai.

#### Catatan Nilai Warna (Perlu Dikonfirmasi Pemilik)

Pantone tidak menerbitkan nilai sRGB resmi yang dapat dipakai langsung; nilai hex berikut hanya pendekatan layar dan harus dikonfirmasi pemilik sebelum dikunci pada token tema. Hasil pencarian pada fase ini:

- Oat, Pantone P 3-9 C: pendekatan #F1EEDB (sumber: [hextopms.com, P 3-9 C](http://hextopms.com/color-to-pms/f1e9dc/pms-cmyk-coated/), menyebut kode ini paling sering dikaitkan dengan P 3-9 C).
- Biru, Pantone P 104-8 C: belum ada sumber tepercaya untuk varian coated. Sumber [hextopms.com](https://hextopms.com/color-to-pms/295ba7/pms-cmyk-uncoated/) hanya menyebut #005DAC untuk varian uncoated (P 104-8 U); nilai ini dipakai sementara sebagai pendekatan.
- Merah_Muda, Pantone P 73-7 C: tidak ditemukan sumber hex yang andal. Nilai ditandai TBD dan harus ditentukan pemilik (referensi resmi: [pantone.com color finder](https://www.pantone.com/color-finder/p-73-7-c)).

Isi tepat setiap nilai ditetapkan pada fase desain setelah konfirmasi pemilik.
