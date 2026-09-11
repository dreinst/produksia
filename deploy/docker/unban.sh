#!/usr/bin/env bash
# Alat superadmin: lihat & buka blokir IP di semua lapisan proteksi (fail2ban, crowdsec, psad, iptables).
# Jalankan sebagai root di server.
#
#   bash unban.sh <IP>            → tampilkan status & BUKTI (read-only; aman) untuk menilai hacker vs bukan
#   bash unban.sh <IP> lepas      → buka blokir IP dari semua lapisan
#   bash unban.sh <IP> percaya    → buka blokir + masukkan ke daftar tepercaya (tak akan diblokir lagi)
#   bash unban.sh daftar          → daftar semua IP yang sedang diblokir
#
# "kecuali hacker": alat ini TIDAK menebak sendiri. Ia menampilkan berapa kali & di mana IP gagal
# plus contoh barisnya, lalu Anda yang memutuskan. IP kantor/rumah karyawan biasanya sedikit gagal
# dan dari lokasi wajar; peretas = ratusan percobaan, banyak user, dari IP asing.
set -uo pipefail
ip="${1:-}"; aksi="${2:-status}"

ada(){ command -v "$1" >/dev/null 2>&1; }
g(){ echo; echo "── $1"; }

if [ "$ip" = "daftar" ]; then
  g "fail2ban (per jail)"
  for j in $(fail2ban-client status 2>/dev/null | awk -F: '/Jail list/{gsub(/,/," ");print $2}'); do
    b=$(fail2ban-client get "$j" banip 2>/dev/null); [ -n "${b// }" ] && echo "  [$j] $b"
  done
  ada cscli && { g "crowdsec"; cscli decisions list -o human 2>/dev/null | grep -vE "No active decisions" | head -20; }
  g "iptables DROP (INPUT + DOCKER-USER)"
  iptables -S INPUT DOCKER-USER 2>/dev/null | grep -E "\-s [0-9.]+/32 -j (DROP|REJECT)" | sed 's/^/  /'
  exit 0
fi

[ -n "$ip" ] || { echo "pakai: bash unban.sh <IP> [lepas|percaya]  |  bash unban.sh daftar"; exit 1; }
echo "$ip" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || { echo "IP tidak valid: $ip"; exit 1; }

echo "════ IP $ip ════"
# --- status di tiap lapisan ---
terban=0
g "fail2ban"
for j in $(fail2ban-client status 2>/dev/null | awk -F: '/Jail list/{gsub(/,/," ");print $2}'); do
  if fail2ban-client get "$j" banip 2>/dev/null | tr ' ' '\n' | grep -qx "$ip"; then echo "  TERBAN di jail: $j"; terban=1; fi
done
[ "$terban" = 0 ] && echo "  tidak terban di fail2ban"
ada cscli && { g "crowdsec"; cscli decisions list -o human 2>/dev/null | grep "$ip" | sed 's/^/  /' || echo "  tidak ada keputusan"; }
g "iptables"
iptables -S INPUT DOCKER-USER 2>/dev/null | grep "$ip" | sed 's/^/  /' || echo "  tidak ada aturan DROP langsung"

# --- BUKTI untuk menilai ---
g "BUKTI (untuk menilai hacker vs bukan)"
echo "  • SSH gagal dari IP ini:  $(grep -h "$ip" /var/log/auth.log* 2>/dev/null | grep -c 'Failed\|Invalid')"
echo "  • Auth DB (PgBouncer) gagal: $(grep -h "$ip" /data/produksia/pgbouncer/log/pgbouncer.log* 2>/dev/null | grep -c 'authentication failed\|no such user')"
echo "  • Contoh baris terakhir:"
{ grep -h "$ip" /data/produksia/pgbouncer/log/pgbouncer.log* 2>/dev/null | tail -2; grep -h "$ip" /var/log/auth.log* 2>/dev/null | grep 'Failed\|Invalid' | tail -2; } | sed 's/^/      /'
ada whois && echo "  • Lokasi/pemilik: $(whois "$ip" 2>/dev/null | grep -iE '^(country|orgname|netname):' | head -3 | awk '{print $2}' | tr '\n' ' ')"

if [ "$aksi" = "status" ]; then
  echo; echo "→ Untuk membuka: bash unban.sh $ip lepas   (atau 'percaya' untuk sekaligus jadikan tepercaya)"
  exit 0
fi

# --- aksi buka blokir ---
g "MEMBUKA BLOKIR $ip"
for j in $(fail2ban-client status 2>/dev/null | awk -F: '/Jail list/{gsub(/,/," ");print $2}'); do
  fail2ban-client set "$j" unbanip "$ip" >/dev/null 2>&1 && echo "  fail2ban[$j]: dibuka"
done
ada cscli && { cscli decisions delete --ip "$ip" >/dev/null 2>&1 && echo "  crowdsec: dibuka"; }
ada psad && { psad --fw-rm-block-ip "$ip" >/dev/null 2>&1 && echo "  psad: dibuka"; }
iptables -D INPUT -s "$ip" -j DROP 2>/dev/null && echo "  iptables INPUT: dihapus"
iptables -D DOCKER-USER -s "$ip" -j DROP 2>/dev/null && echo "  iptables DOCKER-USER: dihapus"

if [ "$aksi" = "percaya" ]; then
  g "Menambahkan ke daftar tepercaya (tak akan diblokir lagi)"
  f=/etc/fail2ban/jail.d/00-tepercaya.conf
  if [ -f "$f" ] && grep -q "$ip" "$f"; then echo "  sudah tepercaya"; else
    if [ ! -f "$f" ]; then printf '[DEFAULT]\nignoreip = 127.0.0.1/8 ::1 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 %s\n' "$ip" > "$f";
    else sed -i "s#^ignoreip = .*#& $ip#" "$f"; fi
    systemctl reload fail2ban 2>/dev/null || systemctl restart fail2ban
    ada cscli && cscli decisions add --ip "$ip" --type whitelist --duration 8760h >/dev/null 2>&1
    echo "  ditambahkan ke ignoreip fail2ban$(ada cscli && echo ' + whitelist crowdsec')"
    echo "  (hapus nanti: sunting $f)"
  fi
fi
echo; echo "Selesai. Cek ulang: bash unban.sh $ip"
