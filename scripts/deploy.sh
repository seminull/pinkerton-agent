#!/usr/bin/env bash
#
# Deploy the checkout this script lives in. Run it ON the server, from anywhere
# inside the repo:
#
#   scripts/deploy.sh             pull the current branch, rebuild, restart
#   scripts/deploy.sh --no-pull   rebuild and restart what is already checked out
#   scripts/deploy.sh --no-backup skip the database backup taken before deploying
#
# Safe to re-run. It needs nothing on the host but Docker and git.
#
# What "deploy" is here: one `docker compose up --build --wait` with the
# production overlay. That rebuilds both images from the working tree, runs
# pending migrations in the one-shot `migrate` service, and only then replaces
# the API and web containers — so a failed migration stops the deploy with the
# old version still serving.

# -e: stop at the first failure rather than restarting containers on top of a
#     failed pull or build. -u: a typo'd variable is an error, not an empty
#     string. pipefail: a failure anywhere in a pipeline counts.
set -euo pipefail

# Work from the repo root no matter where the script was called from; compose
# resolves both files and .env relative to the current directory.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# A function, not a variable holding the command: this is also run by people
# whose login shell is zsh, which does not split a variable into words.
compose() {
  docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"
}

PULL=1
BACKUP=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --no-backup) BACKUP=0 ;;
    -h | --help)
      # Print the comment block at the top of this file as the help text.
      sed -n '3,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# Without .env the stack would come up on the public default database password
# — the overlay refuses that, but with a message about a missing variable that
# doesn't say what to do. Say it here instead.
if [[ ! -f .env ]]; then
  echo "No .env here. Copy .env.example to .env and set a strong POSTGRES_PASSWORD first." >&2
  exit 1
fi

if [[ "$PULL" == 1 ]]; then
  echo "==> Pulling $(git rev-parse --abbrev-ref HEAD)"
  # --ff-only: the server is never where commits are made, so anything other
  # than a clean fast-forward means the checkout has drifted, and that should
  # stop the deploy and be looked at rather than be merged around.
  git pull --ff-only
fi

echo "==> Deploying $(git log --oneline -1)"
# Uncommitted edits on the server get built into the images. Almost always a
# mistake (a hot-fix someone forgot), so call it out — but don't block on it.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "    note: this checkout has uncommitted changes, and they are being deployed:"
  git status --short | sed 's/^/      /'
fi

# Back up before anything changes. A deploy runs migrations, and a migration
# is the one step here that can damage data in a way redeploying the old code
# doesn't undo. If the backup fails the deploy stops: shipping without one is
# exactly the situation the backup exists for.
#
# Skipped on a first deploy, when there is no database container yet to dump.
if [[ "$BACKUP" == 1 ]]; then
  if docker inspect -f '{{.State.Running}}' pinkerton-postgres 2>/dev/null | grep -q true; then
    echo "==> Backing up the database"
    scripts/backup.sh
  else
    echo "==> No running database yet; skipping the pre-deploy backup"
  fi
fi

compose up -d --build --wait

echo "==> Containers"
compose ps --format 'table {{.Name}}\t{{.Status}}'

# `--wait` already proved the containers are healthy. This asks the question
# that actually matters — does a request through the front door reach the API
# and the database — on the same port the tunnel uses.
PORT="$(grep -E '^WEB_PORT=' .env | tail -1 | cut -d= -f2 || true)"
PORT="${PORT:-8090}"
echo "==> Health check on 127.0.0.1:${PORT}"
if curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/api/health"; then
  echo
  echo "Deployed."
else
  echo
  echo "Containers are up but the health check failed. Look at: docker logs pinkerton-api" >&2
  exit 1
fi
