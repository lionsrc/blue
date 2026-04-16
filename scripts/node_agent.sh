#!/bin/bash
# node_agent.sh
# Lightweight polling agent for SuperProxy nodes.
# Pulls the active user configuration from the management worker and reports node health.

set -euo pipefail

load_env_file() {
    local env_file="$1"

    if [ -f "$env_file" ]; then
        set -a
        # shellcheck disable=SC1090
        . "$env_file"
        set +a
    fi
}

load_env_file "/etc/superproxy/node-agent.env"
load_env_file "/etc/superproxy/agent.env"

WORKER_URL=${WORKER_URL:-"https://api.blue2000.cc"}
AGENT_SECRET=${AGENT_SECRET:-}
NODE_ID=${NODE_ID:-}
AGENT_TOKEN=${AGENT_TOKEN:-}
NODE_IP=${NODE_IP:-}
INTERFACE=${INTERFACE:-}
API_ENDPOINT="$WORKER_URL/api/agent/config"
XRAY_CONF="/usr/local/etc/xray/config.json"
LIMIT_STATE_FILE="/etc/superproxy/node-limits.json"

if [ -n "$NODE_ID" ] || [ -n "$AGENT_TOKEN" ]; then
    if [ -z "$NODE_ID" ] || [ -z "$AGENT_TOKEN" ]; then
        echo "Set both NODE_ID and AGENT_TOKEN for token-auth mode." >&2
        exit 1
    fi
    AUTH_MODE="token"
elif [ -n "$AGENT_SECRET" ]; then
    AUTH_MODE="legacy"
else
    echo "Set AGENT_SECRET for legacy mode, or NODE_ID and AGENT_TOKEN for token-auth mode." >&2
    exit 1
fi

detect_xray_service_user() {
    local service_user
    service_user=$(systemctl show -p User --value xray 2>/dev/null | tr -d '\r')

    if [ -z "$service_user" ]; then
        service_user="root"
    fi

    printf '%s\n' "$service_user"
}

detect_xray_service_group() {
    local service_group
    local service_user

    service_group=$(systemctl show -p Group --value xray 2>/dev/null | tr -d '\r')
    if [ -n "$service_group" ]; then
        printf '%s\n' "$service_group"
        return
    fi

    service_user=$(detect_xray_service_user)
    if service_group=$(id -gn "$service_user" 2>/dev/null); then
        printf '%s\n' "$service_group"
        return
    fi

    printf '%s\n' "root"
}

fix_xray_config_permissions() {
    local xray_user
    local xray_group

    xray_user=$(detect_xray_service_user)
    xray_group=$(detect_xray_service_group)

    chown "$xray_user:$xray_group" "$XRAY_CONF"
    chmod 640 "$XRAY_CONF"
    chmod 755 "$(dirname "$XRAY_CONF")"
}

detect_public_ip() {
    local detected_ip
    detected_ip=$(curl -fsS https://api64.ipify.org 2>/dev/null || curl -fsS https://api.ipify.org 2>/dev/null || true)

    if [ -z "$detected_ip" ]; then
        echo "Unable to detect public IP automatically. Set NODE_IP before running node_agent.sh." >&2
        return 1
    fi

    printf '%s\n' "$detected_ip"
}

detect_primary_interface() {
    local detected_interface
    detected_interface=$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')

    if [ -z "$detected_interface" ]; then
        echo "Unable to detect the primary network interface automatically. Set INTERFACE before running node_agent.sh." >&2
        return 1
    fi

    printf '%s\n' "$detected_interface"
}

setup_tc() {
    if ! ip link show "$INTERFACE" >/dev/null 2>&1; then
        echo "Configured interface $INTERFACE does not exist." >&2
        return 1
    fi

    echo "Initializing root qdisc on $INTERFACE"
    tc qdisc del dev "$INTERFACE" root 2>/dev/null || true
    tc qdisc add dev "$INTERFACE" root handle 1: htb default 30
    tc class add dev "$INTERFACE" parent 1: classid 1:1 htb rate 10gbit ceil 10gbit
    tc class add dev "$INTERFACE" parent 1:1 classid 1:30 htb rate 10gbit ceil 10gbit
}

apply_config() {
    local node_config_json="$1"
    local clients_json
    local tmp_conf

    echo "Updating Xray configuration..."
    clients_json=$(echo "$node_config_json" | jq -c '[.[] | {id: .xrayUuid, email: (.email // ("user-" + (.port | tostring)))}]')
    tmp_conf=$(mktemp)

    if ! jq --argjson clients "$clients_json" '.inbounds[0].settings.clients = $clients' "$XRAY_CONF" > "$tmp_conf"; then
        echo "Failed to render updated Xray config." >&2
        rm -f "$tmp_conf"
        return 1
    fi

    mv "$tmp_conf" "$XRAY_CONF"
    fix_xray_config_permissions
    systemctl reload xray || systemctl restart xray
    mkdir -p "$(dirname "$LIMIT_STATE_FILE")"
    echo "$node_config_json" | jq '.' > "$LIMIT_STATE_FILE"

    echo "Active allocations:"
    echo "$node_config_json" | jq -r '.[]? | "  - email=\(.email // "unknown") plan=\(.subscriptionPlan // .tier // "unknown") speed=\(.speedLimitMbps)Mbps traffic=\(.monthlyTrafficLimitGb)GB devices=\((.deviceLimit // "unlimited"))"'
}

collect_payload() {
    local public_ip="$1"
    local load_1m
    local active_conn

    load_1m=$(uptime | awk -F'load average:' '{ print $2 }' | cut -d, -f1 | xargs)
    active_conn=$(ss -s | awk -F'estab ' '/TCP:/ {print $2}' | cut -d, -f1)
    active_conn=${active_conn:-0}

    jq -cn \
        --arg cpuLoad "$load_1m" \
        --arg activeConnections "$active_conn" \
        --arg publicIp "$public_ip" \
        '{cpuLoad: ($cpuLoad | tonumber? // null), activeConnections: ($activeConnections | tonumber? // 0), publicIp: $publicIp}'
}

if [ -n "$INTERFACE" ] && ! ip link show "$INTERFACE" >/dev/null 2>&1; then
    echo "Configured interface $INTERFACE does not exist. Falling back to auto-detection." >&2
    INTERFACE=""
fi

INTERFACE=${INTERFACE:-$(detect_primary_interface)}

echo "Using Worker API: $API_ENDPOINT"
echo "Agent auth mode: $AUTH_MODE"
if [ -n "$NODE_IP" ]; then
    echo "Reporting node public IP from NODE_IP override: $NODE_IP"
else
    echo "Auto-detecting node public IP on each sync cycle"
fi
echo "Using network interface: $INTERFACE"

setup_tc

while true; do
    if [ -n "$NODE_IP" ]; then
        REPORTED_PUBLIC_IP="$NODE_IP"
    elif ! REPORTED_PUBLIC_IP=$(detect_public_ip); then
        echo "Public IP detection failed. Retrying on next interval." >&2
        sleep 30
        continue
    fi

    echo "[$(date)] Syncing with Management Worker..."
    echo "Current reported public IP: $REPORTED_PUBLIC_IP"

    curl_args=(
      -sS
      -w "%{http_code}"
      -X POST "$API_ENDPOINT"
      -H "Content-Type: application/json"
      -d "$(collect_payload "$REPORTED_PUBLIC_IP")"
    )

    if [ "$AUTH_MODE" = "token" ]; then
        curl_args+=(
          -H "X-Node-Id: $NODE_ID"
          -H "X-Agent-Token: $AGENT_TOKEN"
        )

        if [ -n "$AGENT_SECRET" ]; then
            curl_args+=(-H "X-Agent-Secret: $AGENT_SECRET")
        fi
    else
        curl_args+=(
          -H "X-Node-IP: $REPORTED_PUBLIC_IP"
          -H "X-Agent-Secret: $AGENT_SECRET"
        )
    fi

    if ! RESPONSE=$(curl "${curl_args[@]}"); then
        echo "API sync request failed. Retrying on next interval." >&2
        sleep 30
        continue
    fi

    HTTP_BODY="${RESPONSE:0:${#RESPONSE}-3}"
    HTTP_CODE="${RESPONSE:${#RESPONSE}-3}"

    if [ "$HTTP_CODE" -eq 200 ]; then
        echo "Sync successful. Processing configuration..."
        NODE_CONFIG_JSON=$(echo "$HTTP_BODY" | jq -c '.node_config // []')
        if ! apply_config "$NODE_CONFIG_JSON"; then
            echo "Config apply failed. The agent will retry on the next interval." >&2
        fi
    else
        echo "API sync failed with HTTP $HTTP_CODE. Response: $HTTP_BODY" >&2
    fi

    sleep 30
done
