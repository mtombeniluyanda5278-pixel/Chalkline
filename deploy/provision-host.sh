#!/bin/sh
# Prepares a fresh Ubuntu host to run the stack. Run once, as root:
#   ./provision-host.sh
#
# Installs Docker, opens only what Caddy needs, and adds swap. Re-running is
# harmless; every step checks before acting.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root: sudo ./provision-host.sh" >&2
  exit 1
fi

echo "==> Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "==> Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y -qq ca-certificates curl git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  echo "    already installed"
fi

# ClamAV's signature set makes 4 GB tight during a rebuild or a freshclam
# refresh. Swap keeps a spike from killing Postgres rather than the scanner.
echo "==> Adding swap"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Prefer reclaiming cache over swapping a live database out.
  sysctl -q -w vm.swappiness=10
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
else
  echo "    already present"
fi

# Only Caddy is meant to be reachable. Postgres, Redis, ClamAV and MinIO
# publish no ports, but a firewall means a future mistake cannot expose them.
echo "==> Configuring firewall"
apt-get install -y -qq ufw
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp comment "ssh" >/dev/null
ufw allow 80/tcp comment "http, and the ACME challenge" >/dev/null
ufw allow 443/tcp comment "https" >/dev/null
ufw allow 443/udp comment "http/3" >/dev/null
ufw --force enable >/dev/null
ufw status numbered

echo "==> Enabling automatic security updates"
apt-get install -y -qq unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo
echo "Host ready. Docker $(docker --version | awk '{print $3}' | tr -d ,), swap on, ports 22/80/443 open."
echo "Next: clone the repository, then deploy/generate-env.sh <domain> <email>."
