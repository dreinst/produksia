#!/usr/bin/env bash
# Pasang jail fail2ban Produksia di server (aman diulang): PgBouncer (ban di DOCKER-USER) + recidive,
# dan matikan X11Forwarding sshd. Butuh PgBouncer sudah logging ke file (pasang-pgbouncer.sh terbaru).
set -euo pipefail
cd "$(dirname "$0")/../.."
install -m 644 deploy/fail2ban/action.d/iptables-docker.conf /etc/fail2ban/action.d/iptables-docker.conf
install -m 644 deploy/fail2ban/filter.d/pgbouncer.conf      /etc/fail2ban/filter.d/pgbouncer.conf
install -m 644 deploy/fail2ban/jail.d/pgbouncer.conf        /etc/fail2ban/jail.d/pgbouncer.conf
install -m 644 deploy/fail2ban/jail.d/recidive.conf         /etc/fail2ban/jail.d/recidive.conf
printf 'X11Forwarding no\n' > /etc/ssh/sshd_config.d/99-hardening-produksia.conf
sshd -t && systemctl reload ssh
systemctl restart fail2ban
sleep 2
fail2ban-client status | grep 'Jail list'
