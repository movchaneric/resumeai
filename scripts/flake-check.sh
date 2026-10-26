#!/usr/bin/env bash
# Run one backend test file repeatedly, normally and then under CPU load, to expose flaky async tests.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  scripts/flake-check.sh <test-file> [runs]
  scripts/flake-check.sh --help

Runs one backend test file <runs> times (default 20) with vitest, first normally and then while one busy loop
per CPU core (at most 4) keeps the machine loaded. Prints the pass and fail counts of each phase and exits
non-zero if any run failed. The test file path is relative to backend/ (for example test/routes/runEvents.test.ts).
Needs Postgres for integration tests: docker compose up -d postgres.
USAGE
  exit "${1:-2}"
}

case "${1:-}" in
  --help | -h) usage 0 ;;
  "") usage ;;
esac

file="$1"
runs="${2:-20}"
[[ "$runs" =~ ^[1-9][0-9]*$ ]] || { echo "error: runs must be a positive integer" >&2; exit 2; }

root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$root/backend"
[ -f "$file" ] || { echo "error: test file not found in backend/: $file" >&2; exit 2; }

load_pids=()
stop_load() {
  local pid
  for pid in ${load_pids[@]+"${load_pids[@]}"}; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  load_pids=()
}
trap stop_load EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_phase() {
  local label="$1" pass=0 fail=0 i
  for ((i = 1; i <= runs; i++)); do
    if pnpm exec vitest run "$file" >/dev/null 2>&1; then
      pass=$((pass + 1))
    else
      fail=$((fail + 1))
      echo "  $label run $i failed" >&2
    fi
  done
  echo "$label: $pass passed, $fail failed (of $runs)"
  total_fail=$((total_fail + fail))
}

total_fail=0
run_phase "normal"

cores="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 2)"
[ "$cores" -le 4 ] || cores=4
for ((c = 0; c < cores; c++)); do
  (while :; do :; done) &
  load_pids+=("$!")
done
echo "started $cores busy loops"
run_phase "loaded"
stop_load

[ "$total_fail" -eq 0 ] || { echo "FLAKY: $total_fail run(s) failed" >&2; exit 1; }
echo "OK: no failures"
