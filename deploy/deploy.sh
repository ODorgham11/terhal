#!/usr/bin/env bash
# Runs on the VPS as the deploy user, sent over SSH by .github/workflows/deploy.yml:
#   ssh deploy@vps bash -s -- <env> <server image> <web image> < deploy/deploy.sh
# The workflow first copies compose.yml and <env>.caddy into /opt/terhal/incoming/<env>/ and logs Docker into GHCR.
#
# Order matters: migrations run against the new schema before any new container starts, then the stack is replaced and
# must come up healthy, and only then does Caddy pick up this environment's routes. If any step fails, the script stops
# and whatever was already running keeps serving.
#
# Rolling back by hand (migrations aren't undone, so only roll back across ones that stay compatible):
#   cd /opt/terhal/<env> && cp .env.previous .env && docker compose up -d --wait
set -euo pipefail

env="${1:?environment (staging or main)}"
server_image="${2:?server image}"
web_image="${3:?web image}"

case "$env" in
  staging | main) ;;
  *) echo "Unknown environment: $env" >&2; exit 1 ;;
esac

root=/opt/terhal
dir="$root/$env"
incoming="$root/incoming/$env"

if [[ ! -f "$dir/app.env" ]]; then
  echo "$dir/app.env is missing. Create it from deploy/app.env.example first (see the README)." >&2
  exit 1
fi

install -m 644 "$incoming/compose.yml" "$dir/compose.yml"

# Compose reads .env from the project folder, so plain `docker compose` commands there target this release.
[[ -f "$dir/.env" ]] && cp "$dir/.env" "$dir/.env.previous"
cat > "$dir/.env" <<EOF
COMPOSE_PROJECT_NAME=terhal-$env
TERHAL_ENV=$env
SERVER_IMAGE=$server_image
WEB_IMAGE=$web_image
EOF

cd "$dir"

echo "Pulling $server_image and $web_image"
docker compose pull --quiet

echo "Running migrations"
docker compose run --rm -T migrate < /dev/null

echo "Starting the stack"
docker compose up -d --wait --wait-timeout 180 --remove-orphans

echo "Updating routes"
install -m 644 "$incoming/$env.caddy" "$root/edge/sites/$env.caddy"
docker compose -f "$root/edge/compose.yml" exec -T caddy caddy reload --config /etc/caddy/Caddyfile

# Keeps a week of old images for rollbacks, so the disk doesn't fill up.
docker image prune -af --filter "until=168h" > /dev/null

echo "Deployed $env"
