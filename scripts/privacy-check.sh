#!/usr/bin/env bash
# Scan commits for the private names listed in local-cvs/.private-names (messages and full patches).
# Shared by the pre-push hook and by hand. Never prints a name or a matching line: only commit hashes and file paths.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  scripts/privacy-check.sh [<rev-list args>...]
  scripts/privacy-check.sh --help

Checks the commits selected by the rev-list arguments (default: master..HEAD) for the names in
local-cvs/.private-names (one per line; blank lines and # comments ignored). Matching is case-insensitive and
fixed-string, over each commit message and its full patch. Prints only the hashes and file paths that matched.
Set PRIVATE_NAMES_FILE to read another names file. A missing names file prints a warning and passes.
Exits 1 when something matched, 0 otherwise.
USAGE
  exit "${1:-2}"
}

case "${1:-}" in
  --help | -h) usage 0 ;;
esac

root="$(git rev-parse --show-toplevel)"
names="${PRIVATE_NAMES_FILE:-}"
if [ -z "$names" ]; then
  names="$root/local-cvs/.private-names"
  if [ ! -f "$names" ]; then
    # A linked worktree has no local-cvs/ of its own; look in the main checkout.
    main="$(dirname "$(cd "$root" && git rev-parse --path-format=absolute --git-common-dir)")"
    [ -f "$main/local-cvs/.private-names" ] && names="$main/local-cvs/.private-names"
  fi
fi

if [ ! -f "$names" ]; then
  echo "privacy-check: names file not found; privacy check skipped" >&2
  exit 0
fi

patterns="$(mktemp)"
trap 'rm -f "$patterns"' EXIT
# Drop comments, CR, surrounding whitespace and blank lines (an empty pattern would match everything).
sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$names" | grep -v -e '^#' -e '^$' >"$patterns" || true
if [ ! -s "$patterns" ]; then
  echo "privacy-check: names file has no names; privacy check skipped" >&2
  exit 0
fi

[ $# -gt 0 ] || set -- master..HEAD

found=0
while IFS= read -r commit; do
  short="$(git rev-parse --short "$commit")"
  if git log -1 --format=%B "$commit" | grep -iqF -f "$patterns"; then
    echo "privacy-check: $short commit message" >&2
    found=1
  fi
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if git show --format= -m --no-color "$commit" -- "$path" | grep -iqF -f "$patterns"; then
      echo "privacy-check: $short $path" >&2
      found=1
    fi
  done < <(git diff-tree --root -m -r --no-commit-id --name-only "$commit")
done < <(git rev-list "$@")

if [ "$found" = 1 ]; then
  echo "privacy-check: a private name appears in the commits above; push blocked" >&2
  exit 1
fi
