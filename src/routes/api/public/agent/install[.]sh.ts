import { createFileRoute } from '@tanstack/react-router';

// Public installer script (contains no secrets). The token is passed by the operator via KAG_TOKEN.
const script = (origin: string, events: string) => `#!/usr/bin/env bash
set -euo pipefail
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
install -d -m 700 /etc/kumo-agent
echo "KAG_TOKEN=$KAG_TOKEN" > /etc/kumo-agent/env && chmod 600 /etc/kumo-agent/env
cat > /usr/local/bin/kumo-events.py <<'EVENTS'
${events}
EVENTS
chmod 700 /usr/local/bin/kumo-events.py
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
  if /opt/kumomta/sbin/kumod --validate --policy $DIR/policy/init.lua.new >/tmp/kumo-validate 2>&1 || [ $? -eq 2 ]; then mv $DIR/policy/init.lua.new $DIR/policy/init.lua && systemctl reload-or-restart kumomta && echo "$HASH" > $DIR/.hash; else ERR=$(head -c 400 /tmp/kumo-validate | jq -Rs .); fi
else
  INSTALLED=$(echo "$B" | jq '[.dkim[].bindingId] | unique')
fi
KUMO_AGENT_API="$API" python3 /usr/local/bin/kumo-events.py || exit 1
J=$(curl -fsS -H "$H" "$API/jobs" || echo '{"jobs":[]}')
if [ "$(echo "$J" | jq '.jobs | length')" -gt 0 ]; then
  RES=$(echo "$J" | jq -c '.jobs[]' | while read -r job; do
    id=$(echo "$job" | jq -r .id)
    out=$(echo "$job" | jq -c '{envelope_sender:.sender,content:.content,recipients:[{email:.rcpt}]}' | curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data @- http://127.0.0.1:8000/api/inject/v1)
    if [ "$out" = "200" ]; then jq -nc --arg i "$id" '{id:$i,ok:true}'; else jq -nc --arg i "$id" --arg e "KumoMTA HTTP $out" '{id:$i,ok:false,error:$e}'; fi
  done | jq -sc '{results:.}')
  echo "$RES" | curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' --data @- "$API/jobs" >/dev/null || true
fi
CPU=$(top -bn1 | awk '/Cpu/ {print 100-$8; exit}'); RAM=$(free | awk '/Mem/ {printf "%.0f", $3/$2*100}')
APPLIED=$(cat $DIR/.hash 2>/dev/null || echo "")
jq -n --arg a "1.0" --arg k "$(/opt/kumomta/sbin/kumod --version 2>/dev/null | head -1 | cut -c1-40)" --arg h "$APPLIED" --argjson i "$INSTALLED" --argjson f "$FAILED" --argjson e "$ERR" --argjson c "\${CPU:-0}" --argjson r "\${RAM:-0}" \\
  '{agentVersion:$a,kumoVersion:$k,installed:$i,failed:$f,error:$e,metrics:{cpu:$c,ram:$r}} + (if $h=="" then {} else {appliedHash:$h} end)' \\
  | curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' --data @- "$API/report" >/dev/null
AGENT
sed -i "s#__API__#$API#" /usr/local/bin/kumo-agent && chmod 755 /usr/local/bin/kumo-agent
install -d /opt/kumomta/etc/policy
cat > /etc/systemd/system/kumo-agent.service <<'U'
[Unit]
Description=KumoMTA config agent
[Service]
Type=oneshot
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
systemctl daemon-reload && systemctl enable --now kumomta kumo-agent.timer
/usr/local/bin/kumo-agent && echo "Agent installé et connecté."
`;

export const Route = createFileRoute('/api/public/agent/install.sh')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { eventsScript } = await import('@/lib/kumo-events.server');
        return new Response(script(new URL(request.url).origin, eventsScript), { headers: { 'Content-Type': 'text/x-shellscript; charset=utf-8' } });
      },
    },
  },
});
