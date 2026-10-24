#!/usr/bin/env bash
# Post a demo persona's five spoken answers to /api/residents/<id>/transcript through
# CloudFront, so the resident is ranked for the video recording.
#
# Usage:   BASIC_AUTH='user:pass' scripts/demo_answers.sh <persona>
#          BASIC_AUTH='user:pass' scripts/demo_answers.sh all       # every persona, 2s apart
#   persona: daniel | ruth | maria | linh | samuel | alice | george | henry
# Env:
#   BASIC_AUTH   required, "user:pass" for CloudFront basic auth (never hard-coded here)
#   CF_URL       optional, defaults to the hosted CloudFront URL
# No phone numbers, passwords or keys are stored in this file.
set -euo pipefail

CF_URL="${CF_URL:-https://d1baurlz014iv6.cloudfront.net}"
: "${BASIC_AUTH:?set BASIC_AUTH='user:pass' in your environment}"

post_one() {
  local persona="$1" id a1 a2 a3 a4 a5
  case "$persona" in
    daniel) id="r-001"
      a1="I'm okay but scared."
      a2="No, the ventilator's dead, it shut off when the power went."
      a3="No, I don't have any spares."
      a4="It's already off."
      a5="I need someone here." ;;
    ruth) id="r-002"
      a1="Yes, I'm okay."
      a2="Yes, it's running on the tank now."
      a3="Just one tank left."
      a4="About two hours, I think."
      a5="Someone to bring more oxygen, I can't drive up here." ;;
    maria) id="r-003"
      a1="I'm fine."
      a2="Yeah, it's on battery."
      a3="One spare tank."
      a4="Maybe two hours or so."
      a5="A ride would help, and more oxygen." ;;
    linh) id="r-004"
      a1="Yeah, all good."
      a2="It's working."
      a3="I've got three batteries."
      a4="Probably nine hours."
      a5="Just somewhere to charge my machine." ;;
    samuel) id="r-005"
      a1="Honestly no, it's getting really hard to breathe."
      a2="I think it stopped."
      a3="One."
      a4="Not long."
      a5="Please send someone." ;;
    alice) id="r-006"
      a1="I think so?"
      a2="I'm not really sure, it's making a weird noise."
      a3="My son took the spare, I don't know."
      a4="A few hours maybe?"
      a5="I don't know." ;;
    george) id="r-007"
      a1="Yes, I'm fine."
      a2="Yes, it's working."
      a3="I have two batteries."
      a4="About ten hours."
      a5="No, nothing, thanks." ;;
    henry) id="r-008"
      a1="All good here."
      a2="Yep, it's running."
      a3="Two spare batteries."
      a4="Probably twelve hours."
      a5="Nothing right now." ;;
    *) echo "Unknown persona: $persona" >&2; return 2 ;;
  esac
  local body
  body="$(python3 -c 'import json,sys; print(json.dumps({"answers": sys.argv[1:]}))' \
    "$a1" "$a2" "$a3" "$a4" "$a5")"
  local resp
  resp="$(curl -fsS -u "$BASIC_AUTH" -X POST "$CF_URL/api/residents/$id/transcript" \
    -H 'Content-Type: application/json' -d "$body")"
  printf '%s' "$resp" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d['name'] + ': ' + d['status'] + ' ' + str(d['rule_id']) + ' | ' + str(d['reason'])
      + ' (ai.ok=' + str(d.get('ai', {}).get('ok'))
      + ', confidence=' + str((d.get('facts') or {}).get('confidence')) + ')')
"
}

target="${1:-}"
if [ "$target" = "all" ]; then
  for p in daniel ruth maria linh samuel alice george henry; do
    post_one "$p"
    sleep 2
  done
elif [ -n "$target" ]; then
  post_one "$target"
else
  echo "Usage: BASIC_AUTH='user:pass' $0 {daniel|ruth|maria|linh|samuel|alice|george|henry|all}" >&2
  exit 2
fi
