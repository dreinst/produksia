# Deploy Produksia ke VPS

Ada dua jalur, pilih sesuai server:

- **Jalur A, VPS kosong**: systemd + Caddy + PostgreSQL di host (bagian 1 sampai 6 di bawah).
- **Jalur C, aplikasi di Vercel + basis data di VPS** (PgBouncer TLS di port 6432, bagian 8). Tidak dipakai lagi sejak 9 Oktober 2026.
- **Jalur B, server yang sudah memakai Docker/Coolify/Traefik** (port 80/443 sudah dipakai proxy): stack `docker-compose.yml` dengan PostgreSQL sendiri di volume, dirutekan Traefik lewat jaringan `coolify` dengan HTTPS otomatis (bagian 7). Server `187.53.129.205` (host Coolify) memakai jalur ini, dan ini yang dipakai sekarang (https://produksia.dpro.events).

Rilis peleburan HKA Console (multi perusahaan, berkas, cetak PDF, CRM, keuangan proyek, pemasaran) punya urutan sendiri: baca bagian 10 sebelum deploy versi itu.

## Jalur A

Target: satu VPS Ubuntu 24.04 LTS (2 vCPU, 4 GB RAM cukup untuk puluhan pengguna serentak), PostgreSQL di mesin yang sama, Caddy sebagai reverse proxy dengan HTTPS otomatis, aplikasi berjalan sebagai layanan systemd. Semua berkasnya ada di folder `deploy/`.

## 1. Sekali jalan: pasang server

1. Sewa VPS (Jakarta atau Singapura), pilih Ubuntu 24.04, masuk sebagai root lewat SSH.
2. Arahkan DNS: catatan **A** `produksia.contoh.id` → IP VPS. Tunggu sampai `ping produksia.contoh.id` menjawab IP itu.
3. Jalankan skrip pemasangan (ganti domainnya):

```bash
curl -fsSL https://raw.githubusercontent.com/dreinst/produksia/main/deploy/pasang-server.sh -o pasang.sh
bash pasang.sh produksia.contoh.id
```

Skrip ini memasang Node 22, PostgreSQL 16, Caddy, ufw, fail2ban; membuat pengguna sistem `produksia`, basis data `produksia` dengan kata sandi acak (tersimpan di `/srv/produksia/app/.env`), meng-clone repo ke `/srv/produksia/app`, build pertama (migrasi otomatis), memasang layanan `produksia`, timer backup harian, dan Caddyfile. Boleh dijalankan ulang bila terputus.

4. Buka `https://produksia.contoh.id`. Basis data masih kosong, jadi halaman masuk menampilkan **pemasangan awal**: buat akun Pemilik pertama. Setelah itu terapkan **Pengaturan → Bagan Akun Standar**, isi Pemetaan Akun, lalu tambah pengguna lain.

Jangan jalankan `npm run seed` di produksi: itu menghapus seluruh isi basis data dan mengisi data contoh.

## 2. Memperbarui aplikasi

**Otomatis (disarankan):** setiap push ke `main` yang lolos CI memicu workflow `Deploy` (`.github/workflows/deploy.yml`), yang masuk ke server lewat SSH dan menjalankan `deploy/deploy.sh`. Siapkan sekali:

```bash
# di komputer Anda: buat pasangan kunci khusus deploy
ssh-keygen -t ed25519 -f produksia-deploy -N "" -C deploy-produksia
# di server, sebagai root: daftarkan kunci publiknya untuk pengguna produksia
mkdir -p /srv/produksia/.ssh && cat produksia-deploy.pub >> /srv/produksia/.ssh/authorized_keys
chown -R produksia:produksia /srv/produksia/.ssh && chmod 700 /srv/produksia/.ssh && chmod 600 /srv/produksia/.ssh/authorized_keys
```

Lalu di GitHub → Settings → Secrets and variables → Actions, isi `VPS_HOST` (IP/nama host), `VPS_SSH_KEY` (isi berkas `produksia-deploy`, kunci privat), dan `VPS_SSH_PORT` bila bukan 22. Workflow juga bisa dijalankan manual dari tab Actions.

**Manual:** `ssh produksia@server 'bash /srv/produksia/app/deploy/deploy.sh'`. Skrip menarik kode, `npm ci`, `npm run build` (menjalankan `prisma migrate deploy` lebih dulu), menyalin aset ke keluaran standalone, restart layanan, dan menunggu `/api/sehat` menjawab.

## 3. Operasional harian

| Kebutuhan | Perintah |
|---|---|
| Status & log aplikasi | `systemctl status produksia` · `journalctl -u produksia -f` |
| Log akses HTTPS | `tail -f /var/log/caddy/produksia.log` |
| Restart | `sudo systemctl restart produksia` |
| Cek kesehatan | `curl http://127.0.0.1:3000/api/sehat` → `{"ok":true}` |
| Backup sekarang | `sudo systemctl start produksia-backup.service` |
| Daftar backup | `ls -lh /srv/produksia/backup` (30 hari terakhir, pukul 02:30 WIB) |
| Backup ke luar server | isi `/srv/produksia/backup.env` dengan `RCLONE_REMOTE=gdrive:produksia-backup` setelah `rclone config` |

**Pulihkan dari backup** (menimpa basis data sekarang):

```bash
sudo systemctl stop produksia
sudo -u postgres pg_restore --clean --if-exists --dbname=produksia /srv/produksia/backup/produksia-YYYYMMDD-HHMM.dump
sudo systemctl start produksia
```

## 4. Skala & pengaturan

- `/srv/produksia/app/.env`: `DB_POOL_MAX` (bawaan 10), `ZONA_WAKTU`, `TZ`. Ubah lalu `sudo systemctl restart produksia`.
- Bila ingin lebih dari satu proses Node (mesin 4 vCPU ke atas), jalankan salinan unit dengan `PORT` berbeda dan tambahkan ke `reverse_proxy` di `/etc/caddy/Caddyfile`; pastikan `max_connections` PostgreSQL (bawaan 100) > jumlah proses × `DB_POOL_MAX` + 20.
- Uji beban dari mesin lain: `BEBAN_URL=https://produksia.contoh.id npx tsx skrip/beban.ts` (butuh `.env` yang mengarah ke basis data yang sama untuk membuat sesi uji).

## 5. Keamanan

- Firewall hanya membuka 22, 80, 443; fail2ban aktif untuk SSH. Matikan login SSH dengan kata sandi (`PasswordAuthentication no` di `/etc/ssh/sshd_config`) setelah kunci Anda terpasang.
- Aplikasi hanya mendengar di `127.0.0.1:3000`; publik hanya lewat Caddy (HSTS, nosniff, X-Frame-Options DENY).
- `.env` hanya bisa dibaca root dan `produksia`. Jangan pernah commit `.env`.
- Pembaruan keamanan OS: `apt update && apt upgrade` berkala, atau aktifkan `unattended-upgrades`.

## 6. Masalah umum

- **Migrasi gagal saat deploy**: lihat pesan di keluaran `deploy.sh` / `journalctl -u produksia`. Perbaiki di kode, push lagi; basis data tidak tersentuh sebelum migrasi sukses.
- **HTTPS belum aktif**: DNS belum mengarah ke server atau port 80/443 tertutup. Cek `journalctl -u caddy -n 50`.
- **`/api/sehat` menjawab 503**: PostgreSQL mati atau `DATABASE_URL` salah. `systemctl status postgresql`.
- **Port 3000 dipakai proses lain**: ubah `PORT` di unit systemd dan di Caddyfile.

## 7. Jalur B: server Docker/Coolify (Traefik di 80/443)

Berkas: `Dockerfile` (multi-tahap, keluaran standalone, berjalan sebagai pengguna non-root, healthcheck `/api/sehat`), `docker-compose.yml` (layanan `db` PostgreSQL 16 dengan volume `produksia-db`, `migrasi` sekali jalan `prisma migrate deploy`, `app` dengan label Traefik seperti aplikasi Coolify), `deploy/docker/deploy.sh`, `deploy/docker/backup.sh`.

Pasang pertama kali (sebagai root):

```bash
mkdir -p /data/produksia && cd /data/produksia
git clone https://github.com/dreinst/produksia.git app && cd app
cp .env.docker.example .env.docker
# isi DOMAIN (domain Anda, atau sementara produksia.<IP>.sslip.io) dan DB_PASSWORD acak, misalnya:
#   sed -i "s/^DOMAIN=.*/DOMAIN=produksia.contoh.id/; s/^DB_PASSWORD=.*/DB_PASSWORD=$(openssl rand -hex 24)/" .env.docker
docker compose --env-file .env.docker up -d --build
```

Traefik Coolify membaca label kontainer `app` di jaringan `coolify` dan meminta sertifikat Let's Encrypt untuk `DOMAIN` (DNS harus sudah mengarah ke server). Cek: `curl -s https://DOMAIN/api/sehat` → `{"ok":true}`.

- **Perbarui**: `bash /data/produksia/app/deploy/docker/deploy.sh` (dipakai juga workflow Deploy; set Variables repo `VPS_USER=root`, `DEPLOY_CMD=bash /data/produksia/app/deploy/docker/deploy.sh`).
- **Ganti domain**: ubah `DOMAIN` di `.env.docker`, lalu `docker compose --env-file .env.docker up -d` (kontainer `app` dibuat ulang dengan label baru, data tidak tersentuh).
- **Log**: `docker compose --env-file .env.docker logs -f app` (atau `migrasi`, `db`).
- **Backup**: `deploy/docker/backup.sh` (pasang di cron root pukul 02:30; simpan 30 hari; `RCLONE_REMOTE` opsional di `.env.docker`). Pulihkan: `docker compose --env-file .env.docker exec -T db pg_restore -U produksia -d produksia --clean --if-exists < backup/produksia-YYYYMMDD-HHMM.dump`.
- **Pindah ke Coolify UI** (opsional): buat resource baru tipe Docker Compose dari repo ini; Coolify akan memasang labelnya sendiri, hapus blok `labels` dan jaringan `coolify` dari compose bila memakai jalur itu.

## 8. Jalur C: aplikasi di Vercel, basis data di VPS

Catatan lama, tidak dipakai lagi sejak aplikasi pindah ke VPS pada 9 Oktober 2026. Waktu itu aplikasi berjalan di Vercel (akun `dreinst`, region `sin1` Singapura, dekat VPS Kuala Lumpur), basis data PostgreSQL tetap di VPS di balik **PgBouncer** dengan TLS (port 6432). Fungsi serverless membuka koneksi pendek dalam jumlah besar, PgBouncer (mode transaksi) menjaganya tetap di bawah batas PostgreSQL.

### Di VPS (sudah dipasang)

```bash
cd /data/produksia/app
bash deploy/docker/pasang-pgbouncer.sh     # sertifikat TLS, userlist, pgbouncer.ini, kontainer pgbouncer, berkas nilai env Vercel
TRUSTED_IPS="IP.mac.anda" bash deploy/docker/firewall.sh   # ufw + ufw-docker: hanya 22/80/443/6432 publik
```

Host basis data di URL memakai nama DNS `produksia.<IP>.sslip.io` (ada di SAN sertifikat), bukan IP, karena driver `pg` hanya memverifikasi sertifikat dengan benar untuk host bernama. Punya domain sendiri? Jalankan ulang dengan `DB_HOST_PUBLIK=db.domain.id` (sebelum sertifikat dibuat, atau hapus `/data/produksia/pgbouncer/tls` dulu).

`pasang-pgbouncer.sh` menulis semua nilai lingkungan untuk Vercel ke `/data/produksia/vercel-env.txt` (hanya root): `DATABASE_URL` (pool transaksi, tanpa `sslmode` karena TLS dipasang lewat `DB_SSL_CA`), `DATABASE_URL_MIGRASI` (basis data `produksia_migrasi`, mode session; dulu dipakai `prisma migrate deploy` saat build, sekarang migrasi dijalankan dari VPS, lihat bagian 9), `DB_POOL_MAX=3`, `ZONA_WAKTU`, dan `DB_SSL_CA` (sertifikat server PgBouncer; aplikasi memverifikasi TLS secara ketat terhadap sertifikat ini, lihat `src/lib/db.ts`).

### Di Vercel (sekali)

1. Vercel → Add New Project → impor repo GitHub `dreinst/produksia`. Framework Next.js terdeteksi; `vercel.json` sudah menetapkan region `sin1`. Node 22 diambil dari `engines` di `package.json`.
2. Environment Variables (centang hanya **Production**): salin isi `/data/produksia/vercel-env.txt` baris per baris. Untuk `DB_SSL_CA` tempel apa adanya (berisi `\n`; kode mengembalikannya menjadi baris baru).
3. Deploy. Saat build, `prebuild` hanya menjalankan `prisma generate`, lalu `next build`; migrasi dijalankan terpisah dari VPS (bagian 9).
4. Settings → Git: matikan deploy otomatis untuk cabang selain `main` (Preview) supaya pratinjau tidak memakai basis data produksi, atau beri Preview basis data terpisah.
5. Domain: tambahkan domain di Vercel dan arahkan DNS-nya (CNAME ke `cname.vercel-dns.com`).

Setelah Vercel hidup, kontainer `app` di VPS tidak diperlukan lagi: `docker compose --env-file .env.docker stop app` (basis data dan PgBouncer tetap jalan). Menjalankannya kembali kapan saja dengan `up -d app`.

### Catatan keamanan
- Port 6432 terbuka untuk internet karena alamat keluar Vercel tidak tetap. Perlindungannya: TLS wajib, sandi acak 48 karakter, autentikasi SCRAM, dan aplikasi memverifikasi sertifikat server (pinned). PostgreSQL sendiri (5432) tidak pernah dipublikasikan.
- `ufw-docker` membuat aturan ufw berlaku juga untuk port yang dipublikasikan kontainer (bawaan Docker menembus ufw). Coolify UI (8000) dan realtime (6001-6002) kini hanya dari Tailscale dan `TRUSTED_IPS`.
- Ganti sandi basis data: ubah `DB_PASSWORD` di `.env.docker`, `ALTER ROLE produksia PASSWORD '…'` di PostgreSQL, jalankan ulang `pasang-pgbouncer.sh`, perbarui env di Vercel.

> **Keamanan pemasangan awal:** DB awal kosong → `/masuk` menampilkan pembuatan Pemilik pertama. Di produksi ini butuh env `KUNCI_PEMASANGAN` (teks acak). Setel di Vercel (Production), buat akun Pemilik dengan kunci itu, lalu HAPUS variabelnya dan redeploy.

### Firewall lanjutan (jalur B/C)

`bash deploy/docker/pasang-fail2ban.sh` memasang jail fail2ban: **pgbouncer** (5 gagal auth / 10 mnt → ban 1 jam di rantai DOCKER-USER, IP internal & Tailscale dikecualikan), **recidive** (pelanggar berulang → ban 1 minggu), dan mematikan `X11Forwarding` sshd. PgBouncer harus logging ke file (sudah diatur di `pgbouncer.ini` + mount `log/`).

### Buka blokir IP (superadmin)

Bila karyawan/klien salah terblokir, jalankan di server sebagai root:

```bash
cd /data/produksia/app
bash deploy/docker/unban.sh <IP>          # lihat status + BUKTI (aman, read-only)
bash deploy/docker/unban.sh <IP> lepas    # buka blokir dari semua lapisan
bash deploy/docker/unban.sh <IP> percaya  # buka + jadikan tepercaya (tak diblokir lagi)
bash deploy/docker/unban.sh daftar        # daftar semua IP yang diblokir
```

Alat menampilkan jumlah percobaan gagal, contoh barisnya, dan pemilik IP, supaya Anda membedakan karyawan (sedikit gagal, lokasi wajar) dari peretas (ratusan percobaan, IP asing) sebelum membuka. Sengaja tidak ada tombol unban di web app: memberi aplikasi Vercel kendali firewall VPS justru berbahaya bila app diretas.

> **Penting build Vercel:** build Vercel HANYA menjalankan `prisma generate` (lihat skrip `prebuild`/`siapkan`), TIDAK menjalankan `prisma migrate deploy`, supaya build tak bergantung koneksi DB. Migrasi ke DB produksi dijalankan terpisah: dari VPS `cd /data/produksia/app && docker compose --env-file .env.docker run --rm --build migrasi`, atau dari mesin lain `npm run migrasi` dengan `DATABASE_URL` produksi. Jalankan ini setiap kali ada migrasi baru SEBELUM rilis (urutan lengkap di bagian 9).

## 9. Urutan rilis (jalur C)

Kode baru sering butuh tabel atau kolom baru. Karena build Vercel tidak memigrasi, urutannya harus: basis data dulu, aplikasi belakangan. Kalau dibalik, aplikasi baru sudah hidup sementara tabelnya belum ada dan halaman terkait gagal.

1. Di VPS, cek migrasi yang belum diterapkan lalu jalankan:
   ```bash
   cd /data/produksia/app && git pull
   docker compose --env-file .env.docker run --rm --build migrasi
   ```
   Migrasi Prisma bersifat tambah (tabel/kolom baru), jadi aplikasi versi lama tetap jalan di antara langkah 1 dan 2.
2. Push ke `main` (atau deploy manual) supaya Vercel membangun aplikasi baru.
3. Buka halaman yang menyentuh tabel baru dan `/api/sehat`.

Catatan rilis Peminjaman Barang (migrasi `20260918095546_warna_foto_peminjaman`):

- Migrasinya menambah tabel `Foto`, `PeminjamanBarang`, `BarisPeminjamanBarang`, kolom `Barang.warna`, dan constraint `CHECK ("jumlahKembali" <= "jumlah")` yang ditulis manual di berkas migrasi. Pastikan berkas migrasi yang sampai di VPS sama dengan yang di repo (jangan `prisma migrate dev` di server).
- `next.config.ts` menaikkan `experimental.serverActions.bodySizeLimit` ke `3mb` karena formulir peminjaman mengirim sampai 3 foto HP terkompresi (maks 1 MB per foto). Batas badan permintaan Vercel sekitar 4,5 MB, jadi jangan menaikkannya lebih jauh tanpa mengecilkan batas foto. Di jalur A/B, Caddy dan Traefik bawaan tidak membatasi ukuran badan, jadi tidak ada pengaturan tambahan.
- Foto disimpan sebagai `Bytes` di PostgreSQL (tidak ada disk di Vercel, tidak ada volume aplikasi di kontainer). Setiap foto terkompresi sekitar 200 KB; perkiraan PRD: sekitar 75 MB sekali untuk foto barang (100 barang × 3 foto) ditambah 10 sampai 15 MB per bulan untuk foto bukti, jadi basis data dan berkas backup akan tumbuh jauh lebih cepat dari sebelumnya. Pantau ukuran dump di log `backup.sh` (baris `backup: ... (ukuran)`) dan ruang di `/data/produksia/app/backup`; bila mulai ratusan MB, kurangi jumlah hari simpan di `backup.sh` atau pindahkan salinan ke `RCLONE_REMOTE`. Ukuran tabel foto bisa dicek dengan `SELECT pg_size_pretty(pg_total_relation_size('"Foto"'));`.
- Zona waktu: Vercel menjalankan fungsi di UTC dan mengabaikan env `TZ`. Tampilan waktu keluar/kembali memakai `ZONA_WAKTU` (sudah ada di `vercel-env.txt`, bawaan `Asia/Jakarta`), jadi tidak perlu variabel baru. Di jalur A/B `TZ` dan `ZONA_WAKTU` diisi keduanya (`docker-compose.yml`, `.env`), dan nilainya harus sama.

## 10. Rilis peleburan HKA Console

Berlaku untuk rilis pertama cabang `fitur/lebur-hka`. Jalur A dan B sama; perintah migrasi mengikuti jalurnya.

Migrasi baru (aditif, jalan lewat `migrate deploy` biasa):

| Folder | Isi |
|---|---|
| `20261109160000_lebur_hka` | enam perusahaan (`utama` = DPRO, pemilik semua data lama; `tapussa`, `smara`, `bonanova`, `sahara`, `nawasena`), kolom perusahaan di dokumen dan data induk, berkas (`FolderBerkas`, `IsiBerkas`), notifikasi, log bermodul, CRM, pemasaran, keuangan proyek, kop surat, format nomor cetak, peran SOSMED, IKLAN, DESAINER |
| `20261111070000_notifikasi_tautan_aman` | CHECK tautan notifikasi |
| `20261112090000_konsumsi_surat_jalan` | catatan konsumsi surat jalan per baris faktur |
| `20261112100000_batas_jumlah_difaktur` | bagi ulang progres faktur data lama (bug B-10), lalu CHECK `0 <= jumlahDifaktur <= jumlah`; berhenti tanpa mengubah apa pun bila datanya tidak bisa dibagi ulang |

### 10.1 Sebelum deploy (baca saja, di basis data produksi)

1. Cadangkan basis data dan pastikan berkas cadangannya ada.
2. `SHOW default_transaction_isolation;` harus `read committed` (juga lewat PgBouncer).
3. `SELECT COUNT(*) FROM "PengaturanPerusahaan";` paling banyak 1.
4. Bentrok kode akun standar baru. Bila ada hasil berjenis lain, putuskan dulu:
   `SELECT kode, nama, jenis, kelompok FROM "Akun" WHERE kode IN ('1-1750','2-1550','2-1700','5-1500','5-1600','5-1700');`
5. Nama akun beban yang dipetakan otomatis ke kategori anggaran proyek. Pemetaan bawaan hanya dibuat bila kode, jenis, status rinci, dan nama sama dengan `src/lib/baganAkunStandar.ts`:
   `SELECT kode, nama, jenis, kelompok FROM "Akun" WHERE kode IN ('5-1500','5-1600','5-1100','5-1300','5-1200','5-2000','5-7000','5-3100','5-3200','5-3300','5-3400','5-3000','5-4000','5-6000','5-1400','5-5000','5-8000','5-8500','5-9000','5-9500') ORDER BY kode;`
6. Proyek bertanggal terbalik (harus dibetulkan sebelum bisa disimpan ulang):
   `SELECT kode, nama, "tanggalMulai", "tanggalSelesai" FROM "Proyek" WHERE "tanggalSelesai" < "tanggalMulai";`
7. Pesanan berbarang ganda yang akan dibagi ulang migrasi `20261112100000` (total per barang tetap):
   `SELECT p."nomor", bp."barangId", COUNT(*) AS baris, SUM(bp."jumlah") AS dipesan, SUM(bp."jumlahDifaktur") AS difaktur, BOOL_OR(bp."jumlahDifaktur" > bp."jumlah" OR bp."jumlahDifaktur" < 0) AS dibagi_ulang FROM "BarisPesananPenjualan" bp JOIN "PesananPenjualan" p ON p."id" = bp."pesananId" GROUP BY p."nomor", bp."barangId" HAVING COUNT(*) > 1;`
8. Data yang membuat migrasi itu berhenti. Hasilnya harus kosong; bila tidak, betulkan dulu dengan persetujuan pemilik data:
   `SELECT 'pesanan' AS tabel, p."nomor", bp."barangId", SUM(bp."jumlahDifaktur") AS difaktur, SUM(bp."jumlah") AS jumlah FROM "BarisPesananPenjualan" bp JOIN "PesananPenjualan" p ON p."id" = bp."pesananId" GROUP BY p."nomor", bp."barangId" HAVING SUM(bp."jumlahDifaktur") < 0 OR SUM(bp."jumlahDifaktur") > SUM(bp."jumlah") UNION ALL SELECT 'surat jalan', s."nomor", bp."barangId", bp."jumlahDifaktur", bp."jumlah" FROM "BarisPengiriman" bp JOIN "PengirimanPesanan" s ON s."id" = bp."pengirimanId" WHERE bp."jumlahDifaktur" < 0 OR bp."jumlahDifaktur" > bp."jumlah";`
9. Catat kartu Integritas di beranda dan ukuran basis data (`SELECT pg_size_pretty(pg_database_size(current_database()));`) untuk dibandingkan sesudah deploy.

### 10.2 Reverse proxy

- Rute unggah (`/api/berkas`, `/api/cetak/kop/<id>/aset`) memeriksa header Origin terhadap `X-Forwarded-Proto` dan Host. `deploy/Caddyfile` sudah mengirim `header_up X-Forwarded-Proto {scheme}`, dan Traefik mengirimnya secara bawaan. Tanpa header itu, unggah berkas ditolak 403.
- Batas unggah 25 MB per berkas. Kedua rute itu dikecualikan dari matcher `src/proxy.ts` dan membatasi badan sendiri, jadi `proxyClientMaxBodySize` tidak dipakai; batas aksi server tetap `3mb`. Tambahkan batas di reverse proxy supaya badan raksasa tidak dibaca Node sampai `requestTimeout`, misalnya di Caddy `request_body { max_size 27MB }` di dalam blok situs, atau middleware `buffering` (`maxRequestBodyBytes`) di Traefik.
- Log akses reverse proxy memuat token tautan bagi `/b/<token>`. Perlakukan log itu sebagai rahasia.
- Isi berkas tersimpan di PostgreSQL (tabel `IsiBerkas`) dan ikut `pg_dump` harian. Ukuran cadangan bertambah sebanding total berkas; pantau dengan `SELECT pg_size_pretty(pg_total_relation_size('"IsiBerkas"'));` dan sesuaikan retensi di `backup.sh` bila perlu.

### 10.3 Deploy dan pemeriksaan sesudahnya

1. Deploy seperti biasa (bagian 2 atau 7). Migrasi berjalan lebih dulu.
2. `npx prisma migrate status --config prisma7.config.ts` melaporkan skema terkini.
3. `SELECT COUNT(*) FROM "Jurnal" WHERE "perusahaanId" <> 'utama';` = 0, `SELECT COUNT(*) FROM "Perusahaan";` = 6, `SELECT COUNT(*) FROM "FolderBerkas";` = 10.
4. Kartu Integritas sama dengan catatan sebelum deploy. Di Pengaturan › Perusahaan › Integritas, kartu "Catatan konsumsi surat jalan" nol semua.

### 10.4 Langkah sekali sesudah deploy (Pemilik)

1. Pengaturan › Bagan Akun Standar, kartu "Terapkan ke sistem", tekan "Buat N akun" sekali. Langkah ini idempoten, menambah 1-1750, 2-1550, 2-1700, 5-1500, 5-1600, 5-1700 sebagai akun bersama, dan menyiapkan kategori anggaran proyek bawaan. Sebelum langkah ini, Transaksi Antar Perusahaan dan dokumen mitra ditolak dengan pesan yang menunjuk tombol tersebut.
2. Pengaturan › Kategori Anggaran Proyek: periksa kartu "Perlu diperiksa", petakan manual akun yang sesuai, dan pastikan 5-1500 terpetakan ke Talent / Artis serta 5-1600 ke Venue.
3. Lengkapi data perusahaan (alamat, NPWP, rekening, email yang dicetak), format nomor cetak di Dokumen & nomor cetak, serta kop dan tanda tangan di Kop & Template.
4. Pengaturan › Hak Akses: kotak berbingkai kuning menandai hak setujui yang pernah tercabut bug lama; putuskan satu per satu.
5. Uji singkat: pratinjau dan unduh PDF faktur dan kwitansi, simpan PDF ke lampiran, unggah satu berkas besar di /berkas, buka `/b/<token>` di jendela tanpa sesi, lonceng memuat notifikasi, dan `/cari?q=<nomor cetak faktur>` menemukan fakturnya.

### 10.5 Pemulihan

- Migrasi `20261112100000_batas_jumlah_difaktur` berhenti dengan pesan yang menyebut nomor dokumen: datanya belum berubah. Betulkan datanya (kueri 10.1 no. 8), lalu `npx prisma migrate resolve --rolled-back 20261112100000_batas_jumlah_difaktur --config prisma7.config.ts` dan `migrate deploy` lagi.
- Migrasi lain gagal, atau versi baru harus ditarik sesudah jalan: pulihkan cadangan 10.1 no. 1 (bagian 3, "Pulihkan dari backup") lalu deploy kode lama. Kode lama tidak mengenal perusahaan lain, berkas, dan dokumen baru, jadi jangan menjalankannya di atas skema baru. Data yang dicatat sesudah deploy ikut hilang.
- Faktur lama (sebelum migrasi `20261112090000`) dibalik dengan aturan lama bila dihapus. Bila pesanannya punya faktur lain, koreksi lewat retur lebih aman; periksa kartu Barang Terkirim di Integritas sebelum dan sesudahnya.

