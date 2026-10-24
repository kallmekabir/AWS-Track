# CareCall ranking rules

This file is the single source of truth for how CareCall orders people. `app/ranking.py` and `eval/run.py` must match it. If a rule changes, change this file in the same step.

CareCall ranks twice:

1. **Round 1, before the calls:** who do we call first?
2. **Round 2, after each call:** who do we help first?

Bedrock never ranks anyone. It only turns what a person said into facts. Plain Python rules do all ranking, so every decision can be explained and tested.

---

## Round 1: calling order

### Device groups

| Group | Devices | Why this order |
| --- | --- | --- |
| 1 | Oxygen concentrator, home ventilator | Breathing support. Trouble starts within hours or less |
| 2 | Home dialysis, infusion pump | Needed within hours, but there is usually some room |
| 3 | Everything else: CPAP, powered wheelchair, powered bed, other | Important, but rarely life-or-death within hours |

The agency sets `device_group` when it registers the resident. If it is missing, work it out from `device` using the table above, and use group 3 when the device is unknown.

### Order inside the zone

Sort by:

1. `device_group`, lowest first.
2. `backups_on_file` (backup tanks or batteries the agency has on record), fewest first. Unknown counts as 0.
3. `id`, so the order is always the same.

Call the first `MAX_LINES` (4) people. Each time a call ends, call the next person who hasn't been reached. Someone who missed a call goes back in line **after** everyone who hasn't had a first call yet. Only people with `allow_call: true` whose number is on `DIALER_ALLOW_LIST` are ever called.

---

## The call script

Fixed wording. The voice only asks; it never gives medical advice.

1. "Hi, this is CareCall from County Public Health. If this is an emergency, hang up and call 911. Checking on you during the power outage. Are you safe right now?"
2. "Is your medical device working right now?"
3. "How many full backup tanks or batteries do you have?"
4. "About how many hours can you go before you run out?"
5. "Do you need anything else, like medicine, food, a ride, a place to charge, or an oxygen delivery?"

Closing: "Thank you. Our team has your answers. If anything changes or you feel unsafe, hang up and call 911."

**Emergency words at any point:** "can't breathe" (also "cannot breathe", "can not breathe", "not breathing"), "chest pain", "heart attack", "emergency", "ambulance", "call 911", "nine one one", "help me", "I fell", "I've fallen". Say "Please hang up and call 911 now. I'm alerting our medical team." Then end the call and save the result with `emergency: true` (rule R0, Help now).

These are phrases, not single words. A bare "help" is left out on purpose: question 5 invites answers like "help with groceries", which must not end the call. The script (the 5 questions, the closing) and the phrase list (`EMERGENCY_PHRASES`) live in `backend/app/script.py`; `lambdas/lex_hook.py` imports them from there. Change `app/script.py` and the whole app follows.

---

## What Bedrock returns

Bedrock gets the full transcript and must answer through one forced tool, `record_checkin`, with exactly this shape:

```json
{
  "safe": "yes | no | unsure",
  "device_working": "yes | no | unsure",
  "backup_left": "integer or null (backup tanks or batteries left)",
  "hours_left": "number or null (hours until they run out, as the person said it)",
  "needs": ["medicine", "food", "transport", "charging", "oxygen_delivery"],
  "emergency": "true or false",
  "confidence": "number from 0 to 1"
}
```

Rules for the prompt: never guess. If the person didn't say it, use `null` or `"unsure"` and lower `confidence`. Turn words into numbers ("a couple hours" → 2, "one tank" → 1). `needs` holds only items the person asked for.

**Example.** "Yeah I'm okay. It's on the tank now. I've got one left, maybe two hours. I can't drive to get more."

```json
{"safe": "yes", "device_working": "yes", "backup_left": 1, "hours_left": 2,
 "needs": ["transport", "oxygen_delivery"], "emergency": false, "confidence": 0.9}
```

---

## Numbers we work out

| Name | How | Notes |
| --- | --- | --- |
| `hours_left` | From Bedrock. If it's null, use `backup_left × backup_hours_each` (from the registry) when both are known | Otherwise unknown |
| `drive_minutes` | Shortest drive time from any supplier to the home, from Amazon Location `calculate_route_matrix` | Saved on the resident; unknown if Location fails. For the demo, drive times come from the registry (`app/seed.py` `DRIVE_MINUTES`); the Amazon Location route matrix is the production source |
| `time_to_spare` | `hours_left − drive_minutes / 60` | If `drive_minutes` is unknown, use `hours_left` and show "drive time unknown" |
| `runs_out_at` | `now + hours_left` | Drives the countdown on the dashboard |
| `recheck_at` | `runs_out_at − 1 hour`, but no sooner than 30 minutes from now and no later than 3 hours from now | Only for "Needs supplies" and "OK for now" |

---

## Round 2: rules after the call

Check the rules from top to bottom. **The first one that matches decides the level.** Save its rule ID with the result.

| Rule | Condition (in code terms) | Level | Reason shown on screen |
| --- | --- | --- | --- |
| R0 | `emergency` is true, or `safe == "no"` | **Help now** | "Said it's an emergency" / "Said they're not safe" |
| R1 | `device_working == "no"` and `backup_left == 0` | **Help now** | "Device off, no backups left" |
| R2 | `time_to_spare` is known and under 1 hour | **Help now** | "Supplier {drive} min away, {spare} min to spare" |
| R3 | `backup_left == 1`, or `hours_left` is known and under 4 | **Help soon** | "1 backup left" / "{hours} h left" |
| R4 | `confidence < 0.7`, or group 1 and `hours_left` is unknown | **A person must check** | "Answers unclear" |
| R5 | `needs` is not empty | **Needs supplies** | "Needs {needs}" |
| R6 | None of the above | **OK for now** | "Enough supply. Calling again at {recheck_at}" |
| NA | No result after 2 calls (not from Bedrock; set by the calling code) | **Help soon** + welfare check | "No answer (2 tries)" |

The danger rules (R0–R3) come **before** the "unclear" rule on purpose. If Bedrock is unsure but the facts point to danger, we would rather send help than wait.

### The order of the dashboard list

1. Help now
2. Help soon
3. A person must check
4. Needs supplies
5. OK for now
6. Calling now, then not called yet

Inside each level: **least `time_to_spare` first** (unknown counts as 0, so it rises to the top), then `device_group`, then `id`.

### Sketch of `app/ranking.py`

```python
def rank_after_call(facts, resident, drive_minutes):
    hours = facts.hours_left
    if hours is None and facts.backup_left is not None and resident.backup_hours_each:
        hours = facts.backup_left * resident.backup_hours_each
    spare = None if hours is None else hours - (drive_minutes or 0) / 60

    if facts.emergency or facts.safe == "no":
        return "HELP_NOW", "R0", hours, spare
    if facts.device_working == "no" and facts.backup_left == 0:
        return "HELP_NOW", "R1", hours, spare
    if spare is not None and spare < 1:
        return "HELP_NOW", "R2", hours, spare
    if facts.backup_left == 1 or (hours is not None and hours < 4):
        return "HELP_SOON", "R3", hours, spare
    if facts.confidence < 0.7 or (resident.device_group == 1 and hours is None):
        return "PERSON_CHECK", "R4", hours, spare
    if facts.needs:
        return "NEEDS_SUPPLIES", "R5", hours, spare
    return "OK_FOR_NOW", "R6", hours, spare
```

---

## Worked example: Zone A demo

**Round 1.** The first 4 calls go to group 1, fewest backups on file first: Daniel (0), Ruth (1), Maria (2), Linh (3). Samuel (group 2) and George (group 3) are next.

**Round 2.**

| Person | Device | What they said | Backups left | Hours left | Supplier drive | Time to spare | Rule | Level |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Daniel Kim | Ventilator | "It's off. The backup didn't kick in." | 0 | 0 | 25 min | none | R1 | Help now |
| Ruth Okafor | Oxygen | "One tank left, about two hours." | 1 | 2 | 70 min | 50 min | R2 | Help now |
| Maria Lopez | Oxygen | "One tank, maybe two hours. I can't drive." | 1 | 2 | 15 min | 1 h 45 min | R3 | Help soon |
| Linh Tran | Oxygen | "Three tanks, around nine hours. A place to charge would help." | 3 | 9 | 20 min | 8 h 40 min | R5 | Needs supplies |

**Dashboard order:** Daniel, Ruth, Maria, Linh. Ruth and Maria said almost the same thing, but Ruth's supplier is much farther away, so she is ahead of Maria. That is the whole point of time to spare.

---

## Test cases for `eval/run.py`

Each case is a transcript plus the expected rule. The headline number is **missed "Help now" cases. The target is 0.**

| # | Transcript (short) | Registry / drive | Expected |
| --- | --- | --- | --- |
| 1 | "I can't breathe well" | any | R0 |
| 2 | "I'm not okay, I'm scared" | any | R0 |
| 3 | "Machine's off, no tanks left" | group 1 | R1 |
| 4 | "One tank, two hours" | drive 70 min | R2 |
| 5 | "One tank, two hours" | drive 15 min | R3 |
| 6 | "About three hours, two tanks" | drive 20 min | R3 |
| 7 | "Uh, it's on something, a while I guess" | group 1 | R4 |
| 8 | "Plenty of battery, just need food" | group 3, drive 20 min | R5 |
| 9 | "All good, eight hours, nothing needed" | drive 20 min | R6 |
| 10 | (no answer twice) | any | NA |
