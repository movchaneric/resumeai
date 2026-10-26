#!/usr/bin/env bash
# Create and remove numbered worktrees for slice work.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  scripts/worktree.sh add <NN> <name> [--prefix <p>]
  scripts/worktree.sh remove <NN>
  scripts/worktree.sh prune-dbs [--yes]

add     Creates ../resume-ai-wt-<NN> on a new branch <p>/<NN>-<name> based on the current branch,
        copies backend/.env, then installs dependencies and builds @resume-ai/shared.
        The prefix defaults to the slice in the current branch name (feat/slice-4a-x gives slice4a).
remove  Removes ../resume-ai-wt-<NN>, deletes its branch with `git branch -d` (kept if unmerged), and drops its
        test database resume_ai_wt_<NN>_test through the running Postgres container (a warning if it is not running).
prune-dbs  Lists the resume_ai_wt_*_test databases whose worktree folder no longer exists. Drops them only with --yes.
USAGE
  exit 2
}

die() {
  echo "error: $*" >&2
  exit 1
}

# Same rule as testDatabaseName in backend/test/globalSetup.ts.
db_name() {
  local base
  base="$(basename "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g')"
  echo "${base}_test"
}

# The running Postgres container (the one publishing port 15432, see docker-compose.yml); empty when none.
# Not `docker compose exec`: its project name comes from the folder, so a worktree would not find the main checkout's container.
postgres_container() {
  docker ps --filter publish=15432 --format '{{.Names}}' 2>/dev/null | head -n 1 || true
}

# Same user as docker-compose.yml and backend/test/globalSetup.ts.
PG_USER=resume

# Drops one test database. Warns and returns 0 when Postgres is not running or the drop fails.
drop_db() {
  local db="$1" container
  container="$(postgres_container)"
  if [ -z "$container" ]; then
    echo "warning: Postgres is not running; test database $db not dropped. Drop it later with: scripts/worktree.sh prune-dbs --yes" >&2
    return 0
  fi
  if docker exec "$container" dropdb --force --if-exists -U "$PG_USER" "$db" >/dev/null 2>&1; then
    echo "Dropped test database $db"
  else
    echo "warning: could not drop test database $db" >&2
  fi
}

[ $# -ge 1 ] || usage
command="$1"
shift

root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
parent="$(dirname "$root")"

case "$command" in
  add)
    [ $# -ge 2 ] || usage
    nn="$1"
    name="$2"
    shift 2
    prefix=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --prefix)
          [ $# -ge 2 ] || usage
          prefix="$2"
          shift 2
          ;;
        *) usage ;;
      esac
    done

    current="$(git -C "$root" branch --show-current)"
    [ -n "$current" ] || die "detached HEAD; check out a branch first"

    if [ -z "$prefix" ]; then
      slice="$(printf '%s' "$current" | sed -nE 's#(^|.*/)(slice-[A-Za-z0-9]+).*#\2#p')"
      [ -n "$slice" ] || die "cannot derive a prefix from branch '$current'; pass --prefix <p>"
      prefix="${slice//-/}"
    fi

    path="$parent/resume-ai-wt-$nn"
    branch="$prefix/$nn-$name"

    git -C "$root" worktree add "$path" -b "$branch" "$current"

    if [ -f "$root/backend/.env" ]; then
      cp "$root/backend/.env" "$path/backend/.env"
    else
      echo "warning: backend/.env not found; create $path/backend/.env by hand" >&2
    fi

    (
      cd "$path"
      pnpm install --frozen-lockfile
      pnpm --filter @resume-ai/shared build
    )

    echo "Worktree: $path"
    echo "Branch:   $branch (from $current)"
    echo "Test DB:  $(db_name "$path")"
    ;;

  remove)
    [ $# -eq 1 ] || usage
    nn="$1"
    path="$parent/resume-ai-wt-$nn"
    [ -d "$path" ] || die "no worktree at $path"

    branch="$(git -C "$path" branch --show-current)"
    git -C "$root" worktree remove "$path"
    echo "Removed worktree $path"
    drop_db "$(db_name "$path")"

    if [ -z "$branch" ]; then
      echo "Worktree had no branch checked out; nothing to delete."
    elif git -C "$root" branch -d "$branch"; then
      echo "Deleted branch $branch"
    else
      echo "Kept branch $branch: it is not merged. Merge it, or delete it by hand." >&2
    fi
    ;;

  prune-dbs)
    yes=0
    if [ $# -eq 1 ] && [ "$1" = "--yes" ]; then yes=1; elif [ $# -ne 0 ]; then usage; fi
    container="$(postgres_container)"
    [ -n "$container" ] || die "Postgres is not running (docker compose up -d postgres)"
    stale=()
    while IFS= read -r db; do
      [ -n "$db" ] || continue
      nn="${db#resume_ai_wt_}"
      nn="${nn%_test}"
      [ -d "$parent/resume-ai-wt-$nn" ] || stale+=("$db")
    done < <(docker exec "$container" psql -U "$PG_USER" -d postgres -Atc \
      "select datname from pg_database where datname ~ '^resume_ai_wt_.+_test$' order by 1")
    if [ ${#stale[@]} -eq 0 ]; then
      echo "No test databases without a worktree."
    elif [ "$yes" = 1 ]; then
      for db in "${stale[@]}"; do drop_db "$db"; done
    else
      echo "Test databases whose worktree folder no longer exists:"
      printf '  %s\n' "${stale[@]}"
      echo "Drop them with: scripts/worktree.sh prune-dbs --yes"
    fi
    ;;

  *) usage ;;
esac
