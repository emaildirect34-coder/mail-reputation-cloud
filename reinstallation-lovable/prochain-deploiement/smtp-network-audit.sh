#!/bin/sh
# Read-only SMTP network snapshot. Run on the host and in the sending network namespace.
set -eu

for key in \
  net.core.default_qdisc net.core.somaxconn \
  net.ipv4.tcp_congestion_control net.ipv4.tcp_slow_start_after_idle \
  net.ipv4.tcp_tw_reuse net.ipv4.ip_local_port_range net.ipv4.ip_local_reserved_ports
do
  file="/proc/sys/$(printf '%s' "$key" | tr . /)"
  if [ -r "$file" ]; then
    printf '%s = %s\n' "$key" "$(cat "$file")"
  fi
done

if [ -r /proc/uptime ]; then awk '{printf "uptime_seconds = %.0f\n", $1}' /proc/uptime; fi
if [ -r /proc/net/sockstat ]; then awk '/^TCP:/ {print}' /proc/net/sockstat; fi
if [ -r /proc/net/netstat ]; then
  awk '
    $1=="TcpExt:" && !seen++ { for(i=2;i<=NF;i++) header[i]=$i; next }
    $1=="TcpExt:" {
      for(i=2;i<=NF;i++)
        if (header[i] ~ /^(ListenOverflows|ListenDrops|TCPTimeouts|TCPAbortOnMemory|TCPBacklogDrop)$/)
          print header[i] " = " $i
      exit
    }
  ' /proc/net/netstat
fi
if command -v ss >/dev/null 2>&1; then
  if sockets=$(ss -Htan '( dport = :25 )' 2>/dev/null); then
    printf '%s\n' "$sockets" | awk 'NF {n++} END {print "smtp_outbound_sockets = " n+0}'
    exit 0
  fi
fi
set --
for file in /proc/net/tcp /proc/net/tcp6; do
  if [ -r "$file" ]; then set -- "$@" "$file"; fi
done
if [ "$#" -gt 0 ]; then
  awk 'FNR > 1 && $3 ~ /:0019$/ {n++} END {print "smtp_outbound_sockets = " n+0}' "$@"
fi
