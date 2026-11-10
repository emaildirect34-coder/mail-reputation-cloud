set -eu
cd /opt/mail-tester
docker compose -f compose.yaml -f compose.vps.yaml up -d tester rspamd spamassassin
compose=/docker/lobehub/docker-compose.yml
if grep -q 'testeur.mailsuite.me' "$compose"; then exit 0; fi
backup="$compose.before-mail-tester"
cp -n "$compose" "$backup"
docker exec lobehub-caddy cat /etc/caddy/Caddyfile > /opt/mail-tester/caddy-merged
cat >> /opt/mail-tester/caddy-merged <<'EOF'

testeur.mailsuite.me {
  reverse_proxy mailsuite-tester-api:8000
}
EOF
docker cp /opt/mail-tester/caddy-merged lobehub-caddy:/tmp/mail-tester.Caddyfile
docker exec lobehub-caddy caddy validate --config /tmp/mail-tester.Caddyfile --adapter caddyfile
cat >> "$compose" <<'EOF'
      testeur.mailsuite.me {
        reverse_proxy mailsuite-tester-api:8000
      }
EOF
if ! (cd /docker/lobehub && docker compose config --quiet &&
  docker exec lobehub-caddy caddy reload --config /tmp/mail-tester.Caddyfile --adapter caddyfile); then
  cp "$backup" "$compose"
  exit 1
fi
