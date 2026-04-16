#!/bin/bash
# setup_proxy_node.sh
# Run this on a fresh Ubuntu 22.04+ VPS to initialize it as a SuperProxy node.

set -euo pipefail

echo "Starting SuperProxy Node Setup..."

while [ "$#" -gt 0 ]; do
    case "$1" in
        --node-id)
            NODE_ID="$2"
            shift 2
            ;;
        --agent-token)
            AGENT_TOKEN="$2"
            shift 2
            ;;
        --agent-secret)
            AGENT_SECRET="$2"
            shift 2
            ;;
        --worker-url)
            WORKER_URL="$2"
            shift 2
            ;;
        --public-ip)
            NODE_IP="$2"
            shift 2
            ;;
        --interface)
            INTERFACE="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

WORKER_URL=${WORKER_URL:-"https://api.blue2000.cc"}
AGENT_SECRET=${AGENT_SECRET:-}
NODE_ID=${NODE_ID:-}
AGENT_TOKEN=${AGENT_TOKEN:-}
NODE_IP=${NODE_IP:-}
INTERFACE=${INTERFACE:-}

if [ -n "$NODE_ID" ] || [ -n "$AGENT_TOKEN" ]; then
    if [ -z "$NODE_ID" ] || [ -z "$AGENT_TOKEN" ]; then
        echo "Set both NODE_ID and AGENT_TOKEN for token-auth mode." >&2
        exit 1
    fi
    SETUP_AUTH_MODE="token"
elif [ -n "$AGENT_SECRET" ]; then
    SETUP_AUTH_MODE="legacy"
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

    mkdir -p /usr/local/etc/xray
    chown "$xray_user:$xray_group" /usr/local/etc/xray/config.json
    chmod 640 /usr/local/etc/xray/config.json
    chmod 755 /usr/local/etc/xray
}

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

fix_xray_config_permissions

systemctl restart xray
systemctl enable xray

# 4. Install Node Agent Script
echo "Installing Node Polling Agent..."
echo "Configuring node agent auth mode: $SETUP_AUTH_MODE"
mkdir -p /etc/superproxy
cat > /etc/superproxy/agent.env << EOF
WORKER_URL="$WORKER_URL"
AGENT_SECRET="$AGENT_SECRET"
NODE_ID="$NODE_ID"
AGENT_TOKEN="$AGENT_TOKEN"
NODE_IP="$NODE_IP"
INTERFACE="$INTERFACE"
EOF
chmod 600 /etc/superproxy/agent.env
ln -sf /etc/superproxy/agent.env /etc/superproxy/node-agent.env

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/node_agent.sh" ]; then
    cp "$SCRIPT_DIR/node_agent.sh" /usr/local/bin/node_agent.sh
else
    echo "ERROR: node_agent.sh not found next to setup_proxy_node.sh. Place both scripts in the same directory." >&2
    exit 1
fi
chmod +x /usr/local/bin/node_agent.sh

# 5. Create systemd service for the agent
cat > /etc/systemd/system/node-agent.service << 'EOF'
[Unit]
Description=SuperProxy Node Agent
After=network.target

[Service]
EnvironmentFile=/etc/superproxy/agent.env
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
