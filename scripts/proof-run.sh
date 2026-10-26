#!/usr/bin/env bash
# Drive one Run against a running backend: upload a CV and job description, wait for each pause, send Answers, summarise.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  scripts/proof-run.sh [--watch [--kill-at <spec>]] [--review <mode>] <cv-file> <job-description-file> [answers.json]
  scripts/proof-run.sh [--watch [--kill-at <spec>]] [--review <mode>] --resume <run-id> <answers.json>
  scripts/proof-run.sh --watch-run <run-id> [--kill-at <spec>]
  scripts/proof-run.sh --help

Starts a Run (or resumes one that awaits answers), polls until it stops, and prints a JSON summary:
status, score, exitReason, iterations, changes, changesCitingAnswers, error.
At awaiting_answers without an answers file it prints the Questions and the resume command, then exits 0.
--watch follows the Run through its event stream (GET /runs/:id/events, curl -N) instead of polling: it prints one line
per event (status, running step, round used/max, score before->after) to stderr, and opens a new stream after it posts
the answers. The final summary is the same.
--watch-run <run-id> follows an existing Run's event stream the same way until the server closes it, then prints the
summary. It starts nothing and sends no answers.
--kill-at <spec> (only with --watch or --watch-run) kills the server listening on the port of BASE_URL (SIGKILL, found
with lsof; the script's own curl is not touched) as soon as an event matches, prints "KILLED at <spec>" and the Run id
on stdout, and exits 0. It is for proving restart recovery. <spec> is a status (parsing, extracting, tailoring, ...) or
round=<N>, which means iterations.used >= N while tailoring.
--review <mode> (accept-all, reject-first or revise-first): when the Run reaches awaiting_review, POSTs a decision for every
Change (accept all; or reject the first Change and accept the rest; or revise the first replace Change with a short edit
of its own text and accept the rest), waits for completed, and prints the score before/after and each Change's final
status to stderr. Without it a Run that reaches awaiting_review is only summarised.
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
WATCH=0
KILL_AT=""
MAX_REOPENS=5 # a stream that ends while the Run is still in progress (a dropped connection) is reopened this many times

command -v curl >/dev/null || die "curl is required"
command -v jq >/dev/null || die "jq is required"

# Sent by watch_run (a subshell) after it has killed the server.
on_killed() {
  echo "KILLED at $KILL_AT"
  echo "Run id: $run_id"
  exit 0
}
trap on_killed USR1
run_id=""

# 0 when the Run view `$2` satisfies the kill spec `$1`: a status, or round=N (iterations.used >= N while tailoring).
event_matches() {
  local spec="$1" n
  case "$spec" in
    round=*)
      n="${spec#round=}"
      jq -e --argjson n "$n" '.status == "tailoring" and ((.iterations.used // 0) >= $n)' >/dev/null 2>&1 <<<"$2"
      ;;
    *) jq -e --arg s "$spec" '.status == $s' >/dev/null 2>&1 <<<"$2" ;;
  esac
}

# SIGKILLs whatever listens on the port of BASE_URL; only the listener, so the script's own connection is spared.
kill_server() {
  local port pids
  port="$(printf '%s' "$BASE_URL" | sed -nE 's#^[a-z]+://[^/:]+:([0-9]+).*#\1#p')"
  if [ -z "$port" ]; then
    case "$BASE_URL" in https://*) port=443 ;; *) port=80 ;; esac
  fi
  pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
  [ -n "$pids" ] || die "--kill-at: nothing is listening on port $port"
  # shellcheck disable=SC2086
  kill -9 $pids
}

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

# One line for a Run view: status, the step running (or failed), round used/max, score before->after ("-" when absent).
describe_event() {
  jq -r '"  \(.status)  step=\(([.steps[] | select(.state == "running" or .state == "failed") | .key] | first) // "-")  round=\(.iterations.used // "-")/\(.iterations.max // "-")  score=\(.score.before // "-")->\(.score.after // "-")"' <<<"$1"
}

# Follows the event stream until the Run reaches a status that needs the user (the server closes the stream there);
# prints one line per event on stderr and the last Run view on stdout, like wait_for_run.
watch_run() {
  local id="$1" tmp view status reopens=0
  tmp="$(mktemp)"
  while :; do
    : >"$tmp"
    # Process substitution, so the loop runs in this shell and --kill-at can exit from it.
    while IFS= read -r line; do
      case "$line" in
        "data: "*)
          printf '%s\n' "${line#data: }" >"$tmp"
          describe_event "${line#data: }" >&2
          if [ -n "$KILL_AT" ] && event_matches "$KILL_AT" "${line#data: }"; then
            kill_server
            rm -f "$tmp"
            # This runs in a command substitution, so tell the main shell (trap below) to report and exit 0.
            kill -USR1 "$$"
            exit 0
          fi
          ;;
      esac
    done < <(curl -sSN --max-time 700 "$BASE_URL/runs/$id/events" 2>/dev/null || true)
    view="$(cat "$tmp")"
    jq -e 'type == "object" and has("status")' >/dev/null 2>&1 <<<"$view" || { rm -f "$tmp"; die "no events for Run $id (unknown Run, or the stream failed)"; }
    status="$(jq -r '.status' <<<"$view")"
    case " $IN_PROGRESS " in
      *" $status "*) ;;
      *) rm -f "$tmp"; echo "$view"; return 0 ;;
    esac
    reopens=$((reopens + 1))
    [ "$reopens" -le "$MAX_REOPENS" ] || { rm -f "$tmp"; die "the stream for Run $id kept ending while it was $status"; }
    echo "  ... stream ended while $status, reopening" >&2
    sleep 1
  done
}

# Prints the Run's view once it needs the user: by event stream with --watch, otherwise by polling.
follow_run() {
  if [ "$WATCH" = 1 ]; then watch_run "$1"; else wait_for_run "$1"; fi
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
  final="$(follow_run "$id")"
  if [ "$(jq -r '.status' <<<"$final")" = "awaiting_answers" ]; then
    echo "Run $id is waiting for answers. Questions:" >&2
    print_questions "$final"
    if [ -z "$answers" ]; then
      echo "Resume with: scripts/proof-run.sh --resume $id <answers.json>" >&2
      exit 0
    fi
    send_answers "$id" "$final" "$answers"
    final="$(follow_run "$id")"
  fi
}

REVIEW_MODE=""

# Sends the decisions for the mode in REVIEW_MODE for a Run in awaiting_review (`$2` is its view), waits for it to end and
# leaves the completed view in $final. Prints the score and the Change statuses on stderr.
send_review() {
  local id="$1" view="$2" body first edit code reply
  first="$(jq -r '.changes[0].id // empty' <<<"$view")"
  case "$REVIEW_MODE" in
    accept-all) body="$(jq '{decisions: [.changes[] | {changeId: .id, decision: "accept"}]}' <<<"$view")" ;;
    reject-first)
      body="$(jq '{decisions: [.changes | to_entries[] | {changeId: .value.id, decision: (if .key == 0 then "reject" else "accept" end)}]}' <<<"$view")"
      ;;
    revise-first)
      first="$(jq -r '[.changes[] | select(.op == "replace")][0].id // empty' <<<"$view")"
      [ -n "$first" ] || die "revise-first needs a replace Change, and this Run has none"
      # A short edit of the Change's own text: it adds no number, so it passes the stage-1 checks.
      edit="$(jq -r --arg id "$first" '[.changes[] | select(.id == $id)][0].after | sub("[.]$"; "") + " (edited by the reviewer)."' <<<"$view")"
      body="$(jq --arg id "$first" --arg edit "$edit" '{decisions: [.changes[] | if .id == $id then {changeId: .id, decision: "revise", after: $edit} else {changeId: .id, decision: "accept"} end]}' <<<"$view")"
      ;;
  esac
  [ -n "$first" ] || { echo "The Run has no Changes; sending an empty review." >&2; body='{"decisions":[]}'; }
  reply="$(mktemp)"
  code="$(curl -sS --max-time 30 -o "$reply" -w '%{http_code}' -X POST -H 'content-type: application/json' --data-binary "$body" "$BASE_URL/runs/$id/review")" \
    || die "could not reach $BASE_URL"
  if [ "$code" != "202" ]; then
    echo "error: POST /runs/$id/review returned HTTP $code: $(api_error "$(cat "$reply")")" >&2
    rm -f "$reply"
    exit 1
  fi
  rm -f "$reply"
  final="$(follow_run "$id")"
  jq -r '"Review ("'"$REVIEW_MODE"'"): status \(.status), score \(.score.before) -> \(.score.after)", (.changes[]? | "  \(.id) \(.op): \(.status)")' <<<"$final" >&2
}

# After the pauses: reviews a Run that is waiting for review when --review was given.
maybe_review() {
  [ -n "$REVIEW_MODE" ] || return 0
  if [ "$(jq -r '.status' <<<"$final")" = "awaiting_review" ]; then send_review "$1" "$final"; fi
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
watch_run_id=""
while [ $# -gt 0 ]; do
  case "$1" in
    --watch) WATCH=1; shift ;;
    --watch-run)
      [ $# -ge 2 ] || usage
      watch_run_id="$2"
      WATCH=1
      shift 2
      ;;
    --review)
      [ $# -ge 2 ] || usage
      REVIEW_MODE="$2"
      case "$REVIEW_MODE" in accept-all | reject-first | revise-first) ;; *) die "--review expects accept-all, reject-first or revise-first, got '$REVIEW_MODE'" ;; esac
      shift 2
      ;;
    --kill-at)
      [ $# -ge 2 ] || usage
      KILL_AT="$2"
      shift 2
      ;;
    *) break ;;
  esac
done
if [ -n "$KILL_AT" ]; then
  [ "$WATCH" = 1 ] || die "--kill-at works only with --watch or --watch-run"
  [[ "$KILL_AT" =~ ^(round=[0-9]+|[a-z_]+)$ ]] || die "--kill-at expects a status (tailoring) or round=<N>, got '$KILL_AT'"
  command -v lsof >/dev/null || die "lsof is required for --kill-at"
fi
if [ -n "$watch_run_id" ]; then
  [ $# -eq 0 ] || usage
  check_server
  run_id="$watch_run_id"
  final="$(watch_run "$run_id")"
  summarise "$final"
  [ "$(jq -r '.status' <<<"$final")" != "failed" ] || exit 1
  exit 0
fi
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
    final="$(follow_run "$run_id")"
    maybe_review "$run_id"
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
    maybe_review "$run_id"
    ;;
esac

summarise "$final"
[ "$(jq -r '.status' <<<"$final")" != "failed" ] || exit 1
