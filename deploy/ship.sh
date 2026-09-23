#!/bin/sh
# One-shot deploy to a fresh Ubuntu host.
#   ./deploy/ship.sh <server-ip>
#
# Copies the working tree, prepares the host, writes the environment from the
# credentials held in .local/, applies migrations and starts everything. It is
# safe to re-run: the environment file is only generated once, and the database
# bootstrap preserves existing content.
set -eu

IP="${1:-}"
[ -n "$IP" ] || { echo "Usage: ./deploy/ship.sh <server-ip>" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$HOME/.ssh/lessonbench"
REMOTE="ubuntu@$IP"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

[ -f "$KEY" ] || { echo "Missing $KEY" >&2; exit 1; }

# Caddy requests certificates as soon as it starts, and the storage bucket is
# created through the files hostname. If either name points elsewhere, the
# deploy fails later in a way that looks like a certificate problem.
echo "==> Checking DNS points here"
for name in lessonbench.co.za files.lessonbench.co.za; do
  resolved="$(dig +short "$name" @1.1.1.1 | tail -1)"
  if [ "$resolved" != "$IP" ]; then
    echo "$name resolves to '${resolved:-nothing}', not $IP. Update DNS first." >&2
    exit 1
  fi
done

echo "==> Waiting for SSH on $IP"
n=0
until $SSH "$REMOTE" true 2>/dev/null; do
  n=$((n + 1))
  [ "$n" -gt 40 ] && { echo "Could not reach $IP over SSH." >&2; exit 1; }
  sleep 15
done

echo "==> Copying the project"
# The working tree, minus anything the host rebuilds or must never receive.
rsync -az --delete -e "$SSH" \
  --exclude ".git" --exclude "node_modules" --exclude "dist" \
  --exclude "public-build" --exclude ".local" --exclude ".env" \
  --exclude ".env.*" --exclude "mail" --exclude "coverage" \
  --exclude "test-results" --exclude "playwright-report" \
  --exclude "*.zip" --exclude ".venv-*" --exclude "security-audit-chix-11" \
  --exclude "wapiti-report" --exclude ".claude" --exclude ".vercel" \
  --exclude "CNAME" --exclude "chix-*.md" --exclude "postgres" \
  "$ROOT/" "$REMOTE:/home/ubuntu/lessonbench/"

echo "==> Preparing the host"
$SSH "$REMOTE" "sudo sh /home/ubuntu/lessonbench/deploy/provision-host.sh"

echo "==> Writing the environment"
# generate-env.sh refuses to overwrite, which keeps a re-run from rotating
# SESSION_SECRET and signing every teacher out.
$SSH "$REMOTE" "cd /home/ubuntu/lessonbench/deploy && [ -f .env ] || ./generate-env.sh lessonbench.co.za ${ACME_EMAIL:-chixauth@gmail.com}"

# Credentials live only on this machine and are injected over the SSH channel.
for file in "$ROOT/.local/cloudflare.env" "$ROOT/.local/brevo.env" "$ROOT/.local/google.env"; do
  [ -f "$file" ] || { echo "Missing $file" >&2; exit 1; }
  grep -E '^[A-Z_]+=' "$file" | while IFS='=' read -r key value; do
    $SSH "$REMOTE" "cd /home/ubuntu/lessonbench/deploy && \
      sed -i 's|^${key}=.*|${key}=${value}|' .env && \
      grep -q '^${key}=' .env || echo '${key}=${value}' >> .env"
  done
done

echo "==> Starting infrastructure"
$SSH "$REMOTE" "cd /home/ubuntu/lessonbench/deploy && sudo docker compose up -d caddy postgres redis minio clamav"

echo "==> Waiting for the scanner to load its signatures (first run is slow)"
$SSH "$REMOTE" "cd /home/ubuntu/lessonbench/deploy && \
  for i in \$(seq 1 60); do \
    sudo docker compose exec -T clamav clamdscan --ping 1 >/dev/null 2>&1 && break; \
    sleep 20; \
  done"

echo "==> Applying migrations and creating the bucket"
$SSH "$REMOTE" "cd /home/ubuntu/lessonbench/deploy && sudo docker compose --profile bootstrap run --rm bootstrap"

echo "==> Starting the application"
$SSH "$REMOTE" "cd /home/ubuntu/lessonbench/deploy && sudo docker compose up -d"

echo
echo "Deployed. Checking readiness from here:"
sleep 10
curl -sS -m 20 "https://lessonbench.co.za/ready" || \
  echo "(not answering yet — DNS may still point elsewhere, or Caddy is still obtaining its certificate)"
echo
