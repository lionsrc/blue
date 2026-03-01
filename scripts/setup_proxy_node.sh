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
