#!/usr/bin/env bash
# Firewall server Docker/Coolify: ufw + integrasi ufw-docker supaya port yang dipublikasikan kontainer TIDAK
# menembus ufw (bawaan Docker memasang aturan iptables sendiri). Aman diulang.
#   Publik      : 22 (rate-limit), 80, 443 (tcp+udp/HTTP3), 6432 (PgBouncer TLS)
#   Tailscale   : 100.64.0.0/10 boleh ke semua kontainer (Coolify UI, realtime, dsb.)
#   IP tepercaya: TRUSTED_IPS="1.2.3.4 5.6.7.8" bash firewall.sh → boleh ke Coolify UI (8080 kontainer) & realtime (6001-6002)
set -euo pipefail
TRUSTED_IPS="${TRUSTED_IPS:-}"
cp -n /etc/ufw/after.rules /etc/ufw/after.rules.sebelum-ufw-docker 2>/dev/null || true
cp -n /etc/ufw/user.rules /etc/ufw/user.rules.sebelum-ufw-docker 2>/dev/null || true
if ! command -v ufw-docker >/dev/null; then
  wget -qO /usr/local/bin/ufw-docker https://github.com/chaifeng/ufw-docker/raw/master/ufw-docker
  chmod +x /usr/local/bin/ufw-docker
fi
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit 22/tcp comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw allow 443/udp comment 'HTTP/3' >/dev/null
ufw allow 6432/tcp comment 'PgBouncer TLS' >/dev/null
# lalu lintas yang diteruskan ke kontainer (dicek di rantai DOCKER-USER setelah DNAT: port = port kontainer)
ufw route allow proto tcp from any to any port 80 comment 'Traefik HTTP' >/dev/null
ufw route allow proto tcp from any to any port 443 comment 'Traefik HTTPS' >/dev/null
ufw route allow proto udp from any to any port 443 comment 'Traefik HTTP/3' >/dev/null
ufw route allow proto tcp from any to any port 6432 comment 'PgBouncer' >/dev/null
ufw route allow from 100.64.0.0/10 comment 'Tailscale ke kontainer' >/dev/null
for ip in $TRUSTED_IPS; do
  ufw route allow proto tcp from "$ip" to any port 8080 comment 'Coolify UI' >/dev/null
  ufw route allow proto tcp from "$ip" to any port 6001:6002 comment 'Coolify realtime' >/dev/null
done
# pasang rantai DOCKER-USER milik ufw-docker (menolak akses luar ke kontainer kecuali aturan route di atas)
if ! grep -q "BEGIN UFW AND DOCKER" /etc/ufw/after.rules; then
  ufw-docker install
fi
ufw --force enable >/dev/null
ufw reload >/dev/null
echo "== ufw aktif; aturan:"
ufw status | tail -n +4
