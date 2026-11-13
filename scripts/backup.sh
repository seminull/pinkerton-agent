#!/usr/bin/env bash
#
# Back up this deployment's database. Run it ON the server, from anywhere
# inside the repo:
#
#   scripts/backup.sh            dump, verify, prune old dumps
#   scripts/backup.sh --list     show the dumps that exist
#
# Dumps go to ~/backups/pinkerton-agent (override with BACKUP_DIR), one file per
# run: pinkerton-YYYYMMDD-HHMMSS.dump. scripts/deploy.sh runs this before every
# deploy, and a daily cron entry runs it too — see "Backups" in readme.md,
# which also has the restore steps.
#
# These dumps live on the same machine as the database. They protect against a
# bad migration, a bad deploy, or a mistaken command — not against losing the
# disk. An off-site copy is a separate step (see the end of this file).

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Outside the repo on purpose: a `git clean`, a fresh clone, or deleting the
# checkout must not be able to take the backups with it.
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/pinkerton-agent}"
CONTAINER="${PG_CONTAINER:-pinkerton-postgres}"

# Retention: everything from the last KEEP_DAYS days, and never fewer than
# KEEP_MIN files however old they are — so a server that has been switched off
# for two months doesn't prune its only backups the moment it comes back.
KEEP_DAYS=30
KEEP_MIN=10

list() {
  # Newest first. `|| true`: an empty directory is "no backups", not an error.
  ls -1t "$BACKUP_DIR"/pinkerton-*.dump 2>/dev/null || true
}

if [[ "${1:-}" == "--list" ]]; then
  if [[ -z "$(list)" ]]; then
    echo "No backups in $BACKUP_DIR"
  else
    list | while IFS= read -r file; do
      printf '%s  %s\n' "$(du -h "$file" | cut -f1)" "$file"
    done
  fi
  exit 0
elif [[ -n "${1:-}" ]]; then
  echo "unknown option: $1 (try --list)" >&2
  exit 2
fi

if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  echo "backup: $CONTAINER is not running, so there is nothing to dump." >&2
  exit 1
fi

# Explicit modes rather than a umask: a umask set here would also apply to
# whatever the calling script does next (a git pull, a docker build), and
# source files written unreadable have taken a site down before.
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/pinkerton-$stamp.dump"
# Written under a temporary name and renamed only once verified, so a dump cut
# short (disk full, container stopped mid-run) can never sit in the directory
# looking like a good backup.
partial="$target.partial"
trap 'rm -f -- "$partial"' EXIT

# pg_dump runs INSIDE the container, so it is always the same version as the
# server, and it reads the credentials from the container's own environment —
# the password never appears on a command line or in this script. Custom
# format (-Fc) is compressed and lets pg_restore pick out single tables.
docker exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$partial"
chmod 600 "$partial"

# A dump is only a backup if it can be read back. pg_restore --list parses the
# whole archive's table of contents without touching any database.
if [[ ! -s "$partial" ]]; then
  echo "backup: pg_dump produced an empty file." >&2
  exit 1
fi
tables="$(docker exec -i "$CONTAINER" pg_restore --list < "$partial" | grep -c ' TABLE DATA ' || true)"
if [[ "$tables" -lt 1 ]]; then
  echo "backup: the dump could not be read back (no table data found in it)." >&2
  exit 1
fi

mv -- "$partial" "$target"
trap - EXIT
echo "backup: wrote $target ($(du -h "$target" | cut -f1), $tables tables)"

# Prune: files older than KEEP_DAYS, but only those beyond the newest KEEP_MIN.
list | tail -n +"$((KEEP_MIN + 1))" | while IFS= read -r file; do
  if [[ -n "$(find "$file" -mtime +"$KEEP_DAYS" -print 2>/dev/null)" ]]; then
    rm -f -- "$file"
    echo "backup: pruned $(basename "$file")"
  fi
done

# --- Off-site copy -----------------------------------------------------------
# Not set up yet. When there is somewhere to send these (an object-storage
# bucket), the upload belongs here: encrypt "$target" first — it contains
# contacts and sign-in records — then copy it out. Until then, everything above
# is same-machine protection only.
