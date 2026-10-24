#!/usr/bin/env bash
# One-time setup for running the CareCall backend on your laptop.
#
#   aws login --region us-east-1 --profile carecall     # first, sign in (lasts 12 h)
#   ./setup.sh                                          # then run this from backend/
#
# What it does: installs the Python packages into .venv, creates .env from
# .env.example, and fills in the Amazon Connect IDs by asking AWS with YOUR login.
# Nothing secret is written in this file, and it never reads or prints phone numbers.
#
# Options (environment variables):
#   AWS_PROFILE=name      AWS CLI profile to use (default: carecall)
#   CONNECT_FLOW_NAME=x   contact flow to use (default: "CareCall check-in keypad")
set -euo pipefail

cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"   # where the AWS CLI installer puts `aws`

PROFILE="${AWS_PROFILE:-carecall}"
REGION="us-east-1"
FLOW_NAME="${CONNECT_FLOW_NAME:-CareCall check-in keypad}"
PERSONAS="daniel-kim ruth-okafor maria-lopez linh-tran"

step() { printf '\n==> %s\n' "$1"; }
fail() { printf '\nSTOP: %s\n' "$1" >&2; exit 1; }

# ---- 1. Tools ----
step "Checking tools"
command -v python3 >/dev/null || fail "python3 is not installed."
command -v aws >/dev/null || fail "The AWS CLI is not installed. Run:
  curl -fsSL https://awscli.amazonaws.com/v2/install.sh | bash"
echo "python3: $(python3 --version 2>&1)   aws: $(aws --version 2>&1 | cut -d' ' -f1)"

# ---- 2. AWS sign-in ----
step "Checking your AWS sign-in (profile: $PROFILE)"
ACCOUNT="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text 2>/dev/null)" \
  || fail "You're not signed in. Run:
  aws login --region $REGION --profile $PROFILE
then run ./setup.sh again."
echo "Signed in to AWS account $ACCOUNT"

# ---- 3. Python packages ----
step "Installing Python packages into .venv (first run takes a minute)"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements-dev.txt
echo "Done"

# ---- 4. Amazon Connect IDs, looked up with your login ----
step "Looking up the Amazon Connect call center in your account"
aws_q() { aws "$@" --profile "$PROFILE" --region "$REGION" --output text; }

INSTANCE_ID="$(aws_q connect list-instances \
  --query "InstanceSummaryList[?starts_with(InstanceAlias, 'carecall')].Id | [0]")"
[ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != "None" ] \
  || fail "No Amazon Connect instance named carecall-* in account $ACCOUNT.
Are you signed in to the team's hackathon account? (connect/SETUP.md, step 1)"

FLOW_ID="$(aws_q connect list-contact-flows --instance-id "$INSTANCE_ID" \
  --query "ContactFlowSummaryList[?Name=='$FLOW_NAME'].Id | [0]")"
[ -n "$FLOW_ID" ] && [ "$FLOW_ID" != "None" ] \
  || fail "No contact flow named '$FLOW_NAME' in the Connect instance."

INSTANCE_ARN="arn:aws:connect:$REGION:$ACCOUNT:instance/$INSTANCE_ID"
SOURCE_NUMBER="$(aws_q connect list-phone-numbers-v2 --target-arn "$INSTANCE_ARN" \
  --query "ListPhoneNumbersSummaryList[0].PhoneNumber")"
[ -n "$SOURCE_NUMBER" ] && [ "$SOURCE_NUMBER" != "None" ] \
  || fail "The Connect instance has no phone number yet (connect/SETUP.md, step 1)."

echo "Call center:  $INSTANCE_ID"
echo "Call script:  $FLOW_NAME ($FLOW_ID)"
echo "Caller ID:    $SOURCE_NUMBER   (the team's AWS number, not a personal phone)"

# ---- 5. backend/.env ----
step "Writing backend/.env (git-ignored)"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi
# Update just these keys and keep everything else in .env as it is.
.venv/bin/python - "$PROFILE" "$INSTANCE_ID" "$FLOW_ID" "$SOURCE_NUMBER" <<'PY'
import sys
from pathlib import Path

profile, instance_id, flow_id, source_number = sys.argv[1:]
wanted = {
    "AWS_PROFILE": profile,
    "AWS_DEFAULT_REGION": "us-east-1",
    "CONNECT_INSTANCE_ID": instance_id,
    "CONNECT_CONTACT_FLOW_ID": flow_id,
    "CONNECT_SOURCE_NUMBER": source_number,
    "PHONES_SSM_PATH": "/carecall/phones",
    "BEDROCK_MODEL_ID": "us.amazon.nova-lite-v1:0",   # reads the keypad answers
    "LOCATION_ENABLED": "1",                           # hospital drive routes on the map
}
path = Path(".env")
lines = path.read_text().splitlines()
seen = set()
for i, line in enumerate(lines):
    key = line.split("=", 1)[0].strip()
    if key in wanted and not line.lstrip().startswith("#"):
        lines[i] = f"{key}={wanted[key]}"
        seen.add(key)
lines += [f"{k}={v}" for k, v in wanted.items() if k not in seen]
path.write_text("\n".join(lines) + "\n")
print("Updated:", ", ".join(wanted))
PY

# ---- 6. web/.env.local: the map key (a browser key, git-ignored) ----
step "Writing web/.env.local (map key)"
MAP_KEY="$(aws_q location describe-key --key-name careline-map-key --query Key 2>/dev/null || true)"
if [ -z "$MAP_KEY" ] || [ "$MAP_KEY" = "None" ]; then
  echo "No careline-map-key found; the dashboard will hide the map."
else
  [ -f ../web/.env.local ] || cp ../web/.env.example ../web/.env.local
  .venv/bin/python - "$MAP_KEY" <<'PY2'
import sys
from pathlib import Path

path = Path("../web/.env.local")
lines = [l for l in path.read_text().splitlines() if not l.startswith("VITE_LOCATION_API_KEY=")]
path.write_text("\n".join(lines + [f"VITE_LOCATION_API_KEY={sys.argv[1]}"]) + "\n")
print("Map key saved (the map only loads at http://localhost:5173)")
PY2
fi

# ---- 7. Check the settings load ----
step "Checking the settings"
.venv/bin/python -c "
from dotenv import load_dotenv; load_dotenv('.env')
from app import calling; calling.check_config(); print('Settings OK')"

# ---- 8. Who has a phone number in Parameter Store (names only, never numbers) ----
step "Phone numbers in Parameter Store (/carecall/phones)"
SAVED="$(aws_q ssm get-parameters-by-path --path /carecall/phones --query 'Parameters[].Name' 2>/dev/null || true)"
for persona in $PERSONAS; do
  case " $SAVED " in
    *"/carecall/phones/$persona"*) echo "  $persona: has a number" ;;
    *) echo "  $persona: free" ;;
  esac
done

cat <<EOF

Setup complete. Next:

1. If your persona has no number yet, add it yourself in the AWS console
   (never paste it into chat or a file): region N. Virginia -> Parameter Store
   -> Create parameter. Name /carecall/phones/<a free persona above>,
   Tier Standard, Type SecureString, Value +1XXXXXXXXXX.

2. Start the backend (keep this terminal open):
     source .venv/bin/activate
     uvicorn app.main:app --reload --env-file .env

3. Start the dashboard in a second terminal:  cd web && npm install && npm run dev

4. Call only your own phone (r-001 Daniel, r-002 Ruth, r-003 Maria, r-004 Linh):
     curl -X POST localhost:8000/residents/r-002/call
   Answer with the keypad; README "Test a call" lists what to press.
   "Start outage" on the dashboard rings EVERY teammate with a number, so warn the team first.
EOF
