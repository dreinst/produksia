# Deploy Produksia ke VPS

Ada dua jalur, pilih sesuai server:

- **Jalur A, VPS kosong**: systemd + Caddy + PostgreSQL di host (bagian 1 sampai 6 di bawah).
- **Jalur C, aplikasi di Vercel + basis data di VPS** (PgBouncer TLS di port 6432, bagian 8). Ini yang dipakai sekarang.
- **Jalur B, server yang sudah memakai Docker/Coolify/Traefik** (port 80/443 sudah dipakai proxy): stack `docker-compose.yml` dengan PostgreSQL sendiri di volume, dirutekan Traefik lewat jaringan `coolify` dengan HTTPS otomatis (bagian 7). Server `187.53.129.205` (host Coolify) memakai jalur ini.

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

Pilihan saat ini: aplikasi berjalan di Vercel (akun `dreinst`, region `sin1` Singapura, dekat VPS Kuala Lumpur), basis data PostgreSQL tetap di VPS di balik **PgBouncer** dengan TLS (port 6432). Fungsi serverless membuka koneksi pendek dalam jumlah besar, PgBouncer (mode transaksi) menjaganya tetap di bawah batas PostgreSQL.

### Di VPS (sudah dipasang)

```bash
cd /data/produksia/app
bash deploy/docker/pasang-pgbouncer.sh     # sertifikat TLS, userlist, pgbouncer.ini, kontainer pgbouncer, berkas nilai env Vercel
TRUSTED_IPS="IP.mac.anda" bash deploy/docker/firewall.sh   # ufw + ufw-docker: hanya 22/80/443/6432 publik
```

Host basis data di URL memakai nama DNS `produksia.<IP>.sslip.io` (ada di SAN sertifikat), bukan IP, karena driver `pg` hanya memverifikasi sertifikat dengan benar untuk host bernama. Punya domain sendiri? Jalankan ulang dengan `DB_HOST_PUBLIK=db.domain.id` (sebelum sertifikat dibuat, atau hapus `/data/produksia/pgbouncer/tls` dulu).

`pasang-pgbouncer.sh` menulis semua nilai lingkungan untuk Vercel ke `/data/produksia/vercel-env.txt` (hanya root): `DATABASE_URL` (pool transaksi, tanpa `sslmode` karena TLS dipasang lewat `DB_SSL_CA`), `DATABASE_URL_MIGRASI` (basis data `produksia_migrasi`, mode session, dipakai `prisma migrate deploy` saat build), `DB_POOL_MAX=3`, `ZONA_WAKTU`, dan `DB_SSL_CA` (sertifikat server PgBouncer; aplikasi memverifikasi TLS secara ketat terhadap sertifikat ini, lihat `src/lib/db.ts`).

### Di Vercel (sekali)

1. Vercel → Add New Project → impor repo GitHub `dreinst/produksia`. Framework Next.js terdeteksi; `vercel.json` sudah menetapkan region `sin1`. Node 22 diambil dari `engines` di `package.json`.
2. Environment Variables (centang hanya **Production**): salin isi `/data/produksia/vercel-env.txt` baris per baris. Untuk `DB_SSL_CA` tempel apa adanya (berisi `\n`; kode mengembalikannya menjadi baris baru).
3. Deploy. Saat build, `prebuild` menjalankan `prisma migrate deploy` lewat `DATABASE_URL_MIGRASI`, lalu `next build`.
4. Settings → Git: matikan deploy otomatis untuk cabang selain `main` (Preview) supaya build pratinjau tidak menjalankan migrasi ke basis data produksi, atau beri Preview basis data terpisah.
5. Domain: tambahkan domain di Vercel dan arahkan DNS-nya (CNAME ke `cname.vercel-dns.com`).

Setelah Vercel hidup, kontainer `app` di VPS tidak diperlukan lagi: `docker compose --env-file .env.docker stop app` (basis data dan PgBouncer tetap jalan). Menjalankannya kembali kapan saja dengan `up -d app`.

### Catatan keamanan
- Port 6432 terbuka untuk internet karena alamat keluar Vercel tidak tetap. Perlindungannya: TLS wajib, sandi acak 48 karakter, autentikasi SCRAM, dan aplikasi memverifikasi sertifikat server (pinned). PostgreSQL sendiri (5432) tidak pernah dipublikasikan.
- `ufw-docker` membuat aturan ufw berlaku juga untuk port yang dipublikasikan kontainer (bawaan Docker menembus ufw). Coolify UI (8000) dan realtime (6001-6002) kini hanya dari Tailscale dan `TRUSTED_IPS`.
- Ganti sandi basis data: ubah `DB_PASSWORD` di `.env.docker`, `ALTER ROLE produksia PASSWORD '…'` di PostgreSQL, jalankan ulang `pasang-pgbouncer.sh`, perbarui env di Vercel.

> **Keamanan pemasangan awal:** DB awal kosong → `/masuk` menampilkan pembuatan Pemilik pertama. Di produksi ini butuh env `KUNCI_PEMASANGAN` (teks acak). Setel di Vercel (Production), buat akun Pemilik dengan kunci itu, lalu HAPUS variabelnya dan redeploy.
