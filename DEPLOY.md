# Deploy Produksia ke VPS

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
