#!/bin/bash
# setup_proxy_node.sh
# Run this on a fresh Ubuntu 22.04+ VPS to initialize it as a SuperProxy node.

set -e

echo "Starting SuperProxy Node Setup..."

WORKER_URL=${WORKER_URL:-"https://api.blue2000.cc"}
AGENT_SECRET=${AGENT_SECRET:?Set AGENT_SECRET before running setup_proxy_node.sh}
NODE_IP=${NODE_IP:-}

# 1. Update and install dependencies
apt-get update
apt-get install -y curl wget jq unzip iproute2 bc

# 2. Install Xray-core
echo "Installing Xray..."
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install

# 3. Basic Xray Configuration (Base template)
cat > /usr/local/etc/xray/config.json << 'EOF'
{
  "log": {
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "port": 443,
      "protocol": "vless",
      "settings": {
        "clients": [],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "ws",
        "wsSettings": {
          "path": "/sp-ws"
        }
      }
    }
  ],
  "outbounds": [
    {
      "protocol": "freedom"
    }
  ]
}
EOF

systemctl restart xray
systemctl enable xray

# 4. Install Node Agent Script
echo "Installing Node Polling Agent..."
mkdir -p /etc/superproxy
cat > /etc/superproxy/node-agent.env << EOF
WORKER_URL="$WORKER_URL"
AGENT_SECRET="$AGENT_SECRET"
NODE_IP="$NODE_IP"
INTERFACE="eth0"
EOF
chmod 600 /etc/superproxy/node-agent.env

cat > /usr/local/bin/node_agent.sh << 'EOF'
#!/bin/bash
# node_agent.sh
# Polls the Management Worker for users to authorize in Xray and reports node health.

set -euo pipefail

WORKER_URL=${WORKER_URL:-"https://api.blue2000.cc"}
AGENT_SECRET=${AGENT_SECRET:?Set AGENT_SECRET in /etc/superproxy/node-agent.env}
NODE_IP=${NODE_IP:-}
INTERFACE=${INTERFACE:-"eth0"}
API_ENDPOINT="$WORKER_URL/api/agent/config"
XRAY_CONF="/usr/local/etc/xray/config.json"
LIMIT_STATE_FILE="/etc/superproxy/node-limits.json"

detect_public_ip() {
    local detected_ip
    detected_ip=$(curl -fsS https://api64.ipify.org 2>/dev/null || curl -fsS https://api.ipify.org 2>/dev/null || true)

    if [ -z "$detected_ip" ]; then
        echo "Unable to detect public IP automatically. Set NODE_IP in /etc/superproxy/node-agent.env." >&2
        return 1
    fi

    printf '%s\n' "$detected_ip"
}

setup_tc() {
    tc qdisc del dev "$INTERFACE" root 2>/dev/null || true
    tc qdisc add dev "$INTERFACE" root handle 1: htb default 30
    tc class add dev "$INTERFACE" parent 1: classid 1:1 htb rate 10gbit ceil 10gbit
    tc class add dev "$INTERFACE" parent 1:1 classid 1:30 htb rate 10gbit ceil 10gbit
}

apply_config() {
    local node_config_json="$1"
    local clients_json
    local tmp_conf

    clients_json=$(echo "$node_config_json" | jq -c '[.[] | {id: .xrayUuid, email: (.email // ("user-" + (.port | tostring)))}]')
    tmp_conf=$(mktemp)

    if ! jq --argjson clients "$clients_json" '.inbounds[0].settings.clients = $clients' "$XRAY_CONF" > "$tmp_conf"; then
        echo "Failed to render updated Xray config." >&2
        rm -f "$tmp_conf"
        return 1
    fi

    mv "$tmp_conf" "$XRAY_CONF"
    systemctl reload xray || systemctl restart xray
    mkdir -p "$(dirname "$LIMIT_STATE_FILE")"
    echo "$node_config_json" | jq '.' > "$LIMIT_STATE_FILE"

    echo "Active allocations:"
    echo "$node_config_json" | jq -r '.[]? | "  - email=\(.email // "unknown") plan=\(.subscriptionPlan // .tier // "unknown") speed=\(.speedLimitMbps)Mbps traffic=\(.monthlyTrafficLimitGb)GB devices=\((.deviceLimit // "unlimited"))"'
}

collect_payload() {
    local load_1m
    local active_conn

    load_1m=$(uptime | awk -F'load average:' '{ print $2 }' | cut -d, -f1 | xargs)
    active_conn=$(ss -s | awk -F'estab ' '/TCP:/ {print $2}' | cut -d, -f1)
    active_conn=${active_conn:-0}

    jq -cn \
        --arg cpuLoad "$load_1m" \
        --arg activeConnections "$active_conn" \
        '{cpuLoad: ($cpuLoad | tonumber? // null), activeConnections: ($activeConnections | tonumber? // 0)}'
}

NODE_IP=${NODE_IP:-$(detect_public_ip)}
setup_tc

while true; do
    if ! RESPONSE=$(curl -sS -w "%{http_code}" -X POST "$API_ENDPOINT" \
      -H "Content-Type: application/json" \
      -H "X-Node-IP: $NODE_IP" \
      -H "X-Agent-Secret: $AGENT_SECRET" \
      -d "$(collect_payload)"); then
        echo "API sync request failed. Retrying on next interval." >&2
        sleep 30
        continue
    fi

    HTTP_BODY="${RESPONSE:0:${#RESPONSE}-3}"
    HTTP_CODE="${RESPONSE:${#RESPONSE}-3}"

    if [ "$HTTP_CODE" -eq 200 ]; then
        NODE_CONFIG_JSON=$(echo "$HTTP_BODY" | jq -c '.node_config // []')
        if ! apply_config "$NODE_CONFIG_JSON"; then
            echo "Config apply failed. The agent will retry on the next interval." >&2
        fi
    else
        echo "API sync failed with HTTP $HTTP_CODE. Response: $HTTP_BODY" >&2
    fi

    sleep 30
done
EOF

chmod +x /usr/local/bin/node_agent.sh

# 5. Create systemd service for the agent
cat > /etc/systemd/system/node-agent.service << 'EOF'
[Unit]
Description=SuperProxy Node Agent
After=network.target

[Service]
EnvironmentFile=/etc/superproxy/node-agent.env
ExecStart=/usr/local/bin/node_agent.sh
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable node-agent.service
systemctl start node-agent.service

echo "SuperProxy Node Setup Complete! Xray and Node Agent are running."
