import { createFileRoute } from '@tanstack/react-router';

// Public installer script (contains no secrets). The token is passed by the operator via KAG_TOKEN.
const script = (origin: string, events: string, campaignControl: string) => `#!/usr/bin/env bash
set -euo pipefail
KAG_TOKEN="\${KAG_TOKEN:-\${AGENT_TOKEN:-}}"
: "\${KAG_TOKEN:?KAG_TOKEN manquant}"
API="${origin}/api/public/agent"
if ! command -v kumod >/dev/null 2>&1 && [ ! -x /opt/kumomta/sbin/kumod ]; then
  if command -v apt-get >/dev/null; then
    apt-get update -y && apt-get install -y curl jq gnupg
    curl -fsSL https://openrepo.kumomta.com/kumomta-ubuntu-22/public.gpg | gpg --yes --dearmor -o /usr/share/keyrings/kumomta.gpg
    curl -fsSL https://openrepo.kumomta.com/files/kumomta-ubuntu22.list > /etc/apt/sources.list.d/kumomta.list
    apt-get update -y && apt-get install -y kumomta
  else
    dnf install -y dnf-plugins-core jq && dnf config-manager --add-repo https://openrepo.kumomta.com/files/kumomta-rocky.repo && dnf install -y kumomta
  fi
fi
if command -v apt-get >/dev/null; then apt-get install -y python3 python3-zstandard; else dnf install -y python3 python3-zstandard; fi
if ! grep -qw bbr /proc/sys/net/ipv4/tcp_available_congestion_control; then
  modprobe tcp_bbr 2>/dev/null || true
fi
if grep -qw bbr /proc/sys/net/ipv4/tcp_available_congestion_control; then
  if sysctl -w net.core.default_qdisc=fq net.ipv4.tcp_congestion_control=bbr; then
    printf '%s\\n' 'net.core.default_qdisc = fq' 'net.ipv4.tcp_congestion_control = bbr' > /etc/sysctl.d/90-email-direct-bbr.conf
    if grep -q '^tcp_bbr ' /proc/modules; then
      printf '%s\\n' tcp_bbr > /etc/modules-load.d/email-direct-bbr.conf
    fi
  fi
else
  echo 'TCP BBR indisponible sur ce noyau.' >&2
fi
install -d -m 700 /etc/kumo-agent
echo "KAG_TOKEN=$KAG_TOKEN" > /etc/kumo-agent/env && chmod 600 /etc/kumo-agent/env
cat > /usr/local/bin/kumo-events.py <<'EVENTS'
${events}
EVENTS
chmod 700 /usr/local/bin/kumo-events.py
cat > /usr/local/bin/kumo-campaign-control.py <<'CONTROL'
${campaignControl}
CONTROL
chmod 700 /usr/local/bin/kumo-campaign-control.py
cat > /usr/local/bin/kumo-agent <<'AGENT'
#!/usr/bin/env bash
set -uo pipefail
. /etc/kumo-agent/env
API="__API__"; H="Authorization: Bearer $KAG_TOKEN"; DIR=/opt/kumomta/etc
B=$(curl -fsS -H "$H" "$API/config") || exit 1
HASH=$(echo "$B" | jq -r .hash); OLD=$(cat $DIR/.hash 2>/dev/null || true)
INSTALLED='[]'; FAILED='[]'; ERR=null
if [ "$HASH" != "$OLD" ]; then
  for row in $(echo "$B" | jq -c '.dkim[] | @base64'); do
    j=$(echo "$row" | tr -d '"' | base64 -d); dom=$(echo "$j" | jq -r .domain); sel=$(echo "$j" | jq -r .selector); id=$(echo "$j" | jq -r .bindingId)
    install -d -m 750 -o kumod -g kumod $DIR/dkim/$dom
    if echo "$j" | jq -r .key > $DIR/dkim/$dom/$sel.key && chmod 640 $DIR/dkim/$dom/$sel.key && chown kumod:kumod $DIR/dkim/$dom/$sel.key; then INSTALLED=$(echo "$INSTALLED" | jq --arg i "$id" '. + [$i] | unique'); else FAILED=$(echo "$FAILED" | jq --arg i "$id" '. + [{bindingId:$i,error:"écriture clé impossible"}]'); fi
  done
  echo "$B" | jq -r .lua > $DIR/policy/init.lua.new
  if /opt/kumomta/sbin/kumod --user kumod --validate --policy $DIR/policy/init.lua.new >/tmp/kumo-validate 2>&1; then mv $DIR/policy/init.lua.new $DIR/policy/init.lua && systemctl reload-or-restart kumomta && echo "$HASH" > $DIR/.hash; else ERR=$(head -c 400 /tmp/kumo-validate | jq -Rs .); fi
else
  INSTALLED=$(echo "$B" | jq '[.dkim[].bindingId] | unique')
fi
KUMO_AGENT_API="$API" python3 /usr/local/bin/kumo-events.py || exit 1
sync_holds() { KUMO_AGENT_API="$API" python3 /usr/local/bin/kumo-campaign-control.py; }
if ! sync_holds; then
  ERR='"Synchronisation des pauses KumoMTA indisponible"'
fi
CPU=$(top -bn1 | awk '/Cpu/ {print 100-$8; exit}'); RAM=$(free | awk '/Mem/ {printf "%.0f", $3/$2*100}'); DISK=$(df -Pk "$DIR" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
APPLIED=$(cat $DIR/.hash 2>/dev/null || echo "")
if [ "$ERR" = null ] && [ "$HASH" != "$APPLIED" ]; then ERR='"Nouvelle configuration KumoMTA non appliquée"'; fi
MAINTENANCE=null
SINCE=$(echo "$B" | jq -r '.maintenanceSince // empty')
if [ -n "$SINCE" ] && [ "$ERR" = null ] && curl -fsS --max-time 3 http://127.0.0.1:8000/api/check-liveness/v1 >/dev/null; then
  MAINTENANCE=$(curl -fsS --max-time 3 http://127.0.0.1:8000/metrics.json | jq -ce --arg since "$SINCE" '
    .message_count | select(.type == "gauge") | .value
    | select(type == "number" and . >= 0 and . <= 9007199254740991 and floor == .)
    | {since:$since,messages:.}') || MAINTENANCE=null
fi
jq -n --arg a "1.3" --arg k "$(/opt/kumomta/sbin/kumod --version 2>/dev/null | head -1 | cut -c1-40)" --arg h "$APPLIED" --argjson i "$INSTALLED" --argjson f "$FAILED" --argjson e "$ERR" --argjson c "\${CPU:-0}" --argjson r "\${RAM:-0}" --argjson d "\${DISK:-0}" --argjson m "$MAINTENANCE" \\
  '{agentVersion:$a,kumoVersion:$k,installed:$i,failed:$f,error:$e,metrics:{cpu:$c,ram:$r,diskUsedPct:$d,vmtaRouting:true,preferencePermit:true,campaignApproval:true}} + (if $h=="" then {} else {appliedHash:$h} end) + (if $m==null then {} else {maintenance:$m} end)' \\
  | curl -fsS --max-time 30 -X POST -H "$H" -H 'Content-Type: application/json' --data @- "$API/report" >/dev/null || exit 1
[ "$ERR" = null ] || exit 1
J=$(curl -fsS --max-time 30 -H "$H" "$API/jobs" || echo '{"jobs":[]}')
if [ -n "\${SUPPRESSION_BLOOM_SNAPSHOT:-}" ] && [ -r /usr/local/lib/email-direct/suppression-bloom.py ]; then
  suspects=$(printf '%s' "$J" | jq -c '[.jobs[] | {id,rcpt}]' | python3 /usr/local/lib/email-direct/suppression-bloom.py suspects "$SUPPRESSION_BLOOM_SNAPSHOT" 2>/dev/null) || suspects='[]'
  if echo "$suspects" | jq -e 'type == "array" and length > 0' >/dev/null; then
    exclusion=$(jq -nc --argjson ids "$suspects" '{action:"confirm-suppressions",ids:$ids}' | curl -fsS --max-time 5 -H "$H" -H 'Content-Type: application/json' --data @- "$API/campaign-control") || exclusion='{}'
    if echo "$exclusion" | jq -e '.excluded | type == "array"' >/dev/null; then
      filtered=$(echo "$J" | jq -c --argjson result "$exclusion" '.jobs |= map(select(.id as $id | $result.excluded | index($id) | not))') && J="$filtered"
    fi
  fi
fi
if [ "$(echo "$J" | jq '.jobs | length')" -gt 0 ]; then
  HOLD_REFRESHED=0
  CHECKED=0
  RES=$(echo "$J" | jq -c '.jobs[]' | while read -r job; do
    if [ "$CHECKED" -ge 20 ]; then
      KUMO_AGENT_API="$API" python3 /usr/local/bin/kumo-events.py >&2 && sync_holds >&2 || break
      CHECKED=0; HOLD_REFRESHED=0
    fi
    CHECKED=$((CHECKED + 1))
    id=$(echo "$job" | jq -r .id)
    permit=$(echo "$job" | jq -c '{action:"permit",id} + (if .approvalRevision then {approvalRevision} else {} end)' | curl -fsS --max-time 10 -H "$H" -H 'Content-Type: application/json' --data @- "$API/campaign-control") || break
    if ! echo "$permit" | jq -e '.allowed == true' >/dev/null; then
      if [ "$HOLD_REFRESHED" = 0 ]; then sync_holds >&2 || break; HOLD_REFRESHED=1; fi
      continue
    fi
    if ! out=$(echo "$job" | jq -c '{envelope_sender:.sender,content:.content,recipients:[{email:.rcpt,metadata:({campaign_id:.campaignId,pool_id:.vmtaPoolId}|with_entries(select(.value != null)))}]}' | curl -fsS --max-time 20 -H 'Content-Type: application/json' --data @- http://127.0.0.1:8000/api/inject/v1); then
      jq -nc --arg i "$id" '{id:$i,ok:false,uncertain:true}'
    elif echo "$out" | jq -e '.success_count == 1 and .fail_count == 0' >/dev/null; then
      jq -nc --arg i "$id" '{id:$i,ok:true}'
    elif echo "$out" | jq -e '.success_count == 0 and .fail_count == 1' >/dev/null; then
      jq -nc --arg i "$id" '{id:$i,ok:false,error:"Injection KumoMTA refusée"}'
    else
      jq -nc --arg i "$id" '{id:$i,ok:false,uncertain:true}'
    fi
  done | jq -sc '{results:.}')
  echo "$RES" | curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' --data @- "$API/jobs" >/dev/null || true
fi
AGENT
sed -i "s#__API__#$API#" /usr/local/bin/kumo-agent && chmod 755 /usr/local/bin/kumo-agent
install -d /opt/kumomta/etc/policy
cat > /etc/systemd/system/kumo-agent.service <<'U'
[Unit]
Description=KumoMTA config agent
[Service]
Type=oneshot
EnvironmentFile=-/etc/kumo-agent/suppression-bloom.env
ExecStart=/usr/local/bin/kumo-agent
U
cat > /etc/systemd/system/kumo-agent.timer <<'U'
[Unit]
Description=KumoMTA config agent every minute
[Timer]
OnBootSec=30
OnUnitActiveSec=60
[Install]
WantedBy=timers.target
U
# Branded click/open tracking: Caddy serves t.<domain> with on-demand TLS and proxies only tracking paths to the site.
if command -v apt-get >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https || true
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg || true
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list || true
  apt-get update -y && apt-get install -y caddy || true
else dnf install -y caddy || true; fi
if command -v caddy >/dev/null; then
cat > /etc/caddy/Caddyfile <<CADDY
{
  on_demand_tls {
    ask ${origin}/api/public/agent/tls-ask
  }
}
https:// {
  tls {
    on_demand
  }
  @track path /api/public/t/* /api/public/c/* /preferences/* /api/public/unsub/*
  handle @track {
    reverse_proxy ${origin} {
      header_up Host {upstream_hostport}
    }
  }
  handle {
    respond 404
  }
}
CADDY
systemctl enable caddy && systemctl restart caddy || true
fi
systemctl daemon-reload && systemctl enable --now kumomta kumo-agent.timer
/usr/local/bin/kumo-agent && echo "Agent installé et connecté."
`;

export const Route = createFileRoute('/api/public/agent/install.sh')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { eventsScript } = await import('@/lib/kumo-events.server');
        const { campaignControlScript } = await import('@/lib/kumo-campaign-control.server');
        return new Response(script(new URL(request.url).origin, eventsScript, campaignControlScript), { headers: { 'Content-Type': 'text/x-shellscript; charset=utf-8' } });
      },
    },
  },
});
