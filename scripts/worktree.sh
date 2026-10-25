#!/usr/bin/env bash
# Create and remove numbered worktrees for slice work.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  scripts/worktree.sh add <NN> <name> [--prefix <p>]
  scripts/worktree.sh remove <NN>

add     Creates ../resume-ai-wt-<NN> on a new branch <p>/<NN>-<name> based on the current branch,
        copies backend/.env, then installs dependencies and builds @resume-ai/shared.
        The prefix defaults to the slice in the current branch name (feat/slice-4a-x gives slice4a).
remove  Removes ../resume-ai-wt-<NN> and deletes its branch with `git branch -d` (kept if unmerged).
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

    if [ -z "$branch" ]; then
      echo "Worktree had no branch checked out; nothing to delete."
    elif git -C "$root" branch -d "$branch"; then
      echo "Deleted branch $branch"
    else
      echo "Kept branch $branch: it is not merged. Merge it, or delete it by hand." >&2
    fi
    ;;

  *) usage ;;
esac
