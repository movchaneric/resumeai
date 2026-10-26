#!/usr/bin/env bash
# Drive one Run against a running backend: upload a CV and job description, wait for each pause, send Answers, summarise.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  scripts/proof-run.sh <cv-file> <job-description-file> [answers.json]
  scripts/proof-run.sh --resume <run-id> <answers.json>
  scripts/proof-run.sh --help

Starts a Run (or resumes one that awaits answers), polls until it stops, and prints a JSON summary:
status, score, exitReason, iterations, changes, changesCitingAnswers, error.
At awaiting_answers without an answers file it prints the Questions and the resume command, then exits 0.
Exits non-zero if the Run ended failed. Needs curl and jq. BASE_URL defaults to http://localhost:3000.
USAGE
  exit "${1:-2}"
}

die() {
  echo "error: $*" >&2
  exit 1
}

BASE_URL="${BASE_URL:-http://localhost:3000}"
POLL_SECONDS=3
MAX_POLLS=200 # 200 x 3 s = 10 minutes
IN_PROGRESS="parsing extracting tailoring"

command -v curl >/dev/null || die "curl is required"
command -v jq >/dev/null || die "jq is required"

check_server() {
  curl -s -o /dev/null --max-time 5 "$BASE_URL/runs/00000000-0000-0000-0000-000000000000" \
    || die "no server answering at $BASE_URL. Start it with: pnpm --filter backend dev (or set BASE_URL)."
}

# The message of an API error body, whether it is an object or a list. Prints nothing when there is none.
api_error() {
  jq -r 'if type == "array" then .[0] else . end | (.error // .) | if type == "object" then (.message // .code // "") else (. | tostring) end' 2>/dev/null <<<"$1" || true
}

fetch_run() {
  local body
  body="$(curl -sS --max-time 30 "$BASE_URL/runs/$1")" || die "could not reach $BASE_URL"
  jq -e 'type == "object" and has("status")' >/dev/null 2>&1 <<<"$body" || die "unexpected reply for Run $1: $(api_error "$body")"
  echo "$body"
}

# Polls until the status is not in progress; prints the last Run view on stdout.
wait_for_run() {
  local id="$1" body status polls=0
  while :; do
    body="$(fetch_run "$id")"
    status="$(jq -r '.status' <<<"$body")"
    case " $IN_PROGRESS " in
      *" $status "*) ;;
      *) echo "$body"; return 0 ;;
    esac
    polls=$((polls + 1))
    [ "$polls" -lt "$MAX_POLLS" ] || die "Run $id still $status after 10 minutes"
    echo "  ... $status" >&2
    sleep "$POLL_SECONDS"
  done
}

print_questions() {
  jq -r '.questions[] | "  \(.id): \(.text)"' <<<"$1" >&2
}

# Sends the answers file for a Run that awaits answers; `$2` is that Run's current view.
send_answers() {
  local id="$1" view="$2" file="$3" ids unknown code reply
  [ -f "$file" ] || die "answers file not found: $file"
  jq -e . "$file" >/dev/null 2>&1 || die "answers file is not valid JSON: $file"
  ids="$(jq -r 'if type == "array" then . elif type == "object" and (.answers | type) == "array" then .answers else [] end | map(.questionId // empty) | .[]' "$file")"
  echo "Answers given for questions:" >&2
  echo "${ids:-  (none)}" | sed 's/^/  /' >&2
  unknown="$(jq -r --argjson ids "$(jq -R . <<<"$ids" | jq -s 'map(select(. != ""))')" \
    '[.questions[].id] as $q | $ids | map(select(. as $i | $q | index($i) | not)) | .[]' <<<"$view")"
  if [ -n "$unknown" ]; then
    echo "error: these question ids are not among the current Questions:" >&2
    echo "$unknown" | sed 's/^/  /' >&2
    exit 1
  fi
  reply="$(mktemp)"
  code="$(curl -sS --max-time 30 -o "$reply" -w '%{http_code}' -X POST -H 'content-type: application/json' --data-binary "@$file" "$BASE_URL/runs/$id/answers")" \
    || die "could not reach $BASE_URL"
  if [ "$code" != "202" ]; then
    echo "error: POST /runs/$id/answers returned HTTP $code: $(api_error "$(cat "$reply")")" >&2
    rm -f "$reply"
    exit 1
  fi
  rm -f "$reply"
}

# Pauses at awaiting_answers: sends the answers file or prints how to resume. Leaves the final view in $final.
settle() {
  local id="$1" answers="${2:-}"
  final="$(wait_for_run "$id")"
  if [ "$(jq -r '.status' <<<"$final")" = "awaiting_answers" ]; then
    echo "Run $id is waiting for answers. Questions:" >&2
    print_questions "$final"
    if [ -z "$answers" ]; then
      echo "Resume with: scripts/proof-run.sh --resume $id <answers.json>" >&2
      exit 0
    fi
    send_answers "$id" "$final" "$answers"
    final="$(wait_for_run "$id")"
  fi
}

summarise() {
  jq '{
    status,
    score: (.score // null),
    exitReason: (.exitReason // null),
    iterations: (.iterations // null),
    changes: ((.changes // []) | length),
    changesCitingAnswers: ((.changes // []) | map(select((.evidenceIds // []) | any(startswith("ue")))) | length),
    error: (.error // null)
  }' <<<"$1"
}

[ $# -ge 1 ] || usage
final=""
case "$1" in
  --help | -h) usage 0 ;;
  --resume)
    [ $# -eq 3 ] || usage
    check_server
    run_id="$2"
    view="$(fetch_run "$run_id")"
    [ "$(jq -r '.status' <<<"$view")" = "awaiting_answers" ] || die "Run $run_id is $(jq -r '.status' <<<"$view"), not awaiting_answers"
    send_answers "$run_id" "$view" "$3"
    final="$(wait_for_run "$run_id")"
    ;;
  -*) usage ;;
  *)
    [ $# -ge 2 ] && [ $# -le 3 ] || usage
    cv="$1"
    jd="$2"
    [ -f "$cv" ] || die "CV file not found: $cv"
    [ -f "$jd" ] || die "job description file not found: $jd"
    check_server
    reply="$(mktemp)"
    # `jobDescription=<file` makes curl read the file's contents as the field value.
    code="$(curl -sS --max-time 60 -o "$reply" -w '%{http_code}' -F "cv=@$cv" -F "jobDescription=<$jd" "$BASE_URL/runs")" \
      || die "could not reach $BASE_URL"
    if [ "$code" != "201" ] && [ "$code" != "202" ]; then
      echo "error: POST /runs returned HTTP $code: $(api_error "$(cat "$reply")")" >&2
      rm -f "$reply"
      exit 1
    fi
    run_id="$(jq -r '.id // .runId // empty' "$reply")"
    rm -f "$reply"
    [ -n "$run_id" ] || die "POST /runs did not return a Run id"
    echo "Run id: $run_id" >&2
    settle "$run_id" "${3:-}"
    ;;
esac

summarise "$final"
[ "$(jq -r '.status' <<<"$final")" != "failed" ] || exit 1
