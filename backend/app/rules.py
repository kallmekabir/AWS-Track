"""Round 2 ranking from docs/RANKING.md: what we do after a call.

Plain Python with no AWS calls, so the eval can test it without the internet.
Bedrock's facts go in; a level, the rule that decided it and the reason come out.
The first rule that matches wins.

(Round 1, the calling order, is in app/ranking.py. This can move in there once
Kabir's call_results.py lands; it is separate only so we don't edit his file.)
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from app.models import Status
from app.understand import Facts

LOCAL_TZ = ZoneInfo("America/Los_Angeles")   # Santa Clara County: times on screen are local
NEED_WORDS = {"medicine": "medicine", "food": "food", "transport": "a ride",
              "charging": "a place to charge", "oxygen_delivery": "an oxygen delivery"}


@dataclass
class Decision:
    level: Status
    rule_id: str
    reason: str
    hours_left: Optional[float]
    time_to_spare: Optional[float]   # hours
    runs_out_at: Optional[datetime]
    recheck_at: Optional[datetime]


def _clock(when: datetime) -> str:
    """6:15 PM, in local time."""
    return when.astimezone(LOCAL_TZ).strftime("%I:%M %p").lstrip("0")


def _minutes(hours: float) -> int:
    return round(hours * 60)


def rank_after_call(facts: Facts, resident, drive_minutes: Optional[float],
                    now: Optional[datetime] = None) -> Decision:
    """Rules R0-R6. `resident` needs `device_group` and `backup_hours_each`.

    `drive_minutes` is the shortest drive from a hospital, or None if unknown.
    """
    now = now or datetime.now(timezone.utc)
    hours = facts.hours_left
    if hours is None and facts.backup_left is not None and resident.backup_hours_each:
        hours = facts.backup_left * resident.backup_hours_each
    spare = None if hours is None else hours - (drive_minutes or 0) / 60
    runs_out_at = None if hours is None else now + timedelta(hours=hours)

    def decide(level, rule_id, reason, recheck=False):
        recheck_at = None
        if recheck:
            # runs_out_at - 1 h, but no sooner than 30 min and no later than 3 h from now
            target = runs_out_at - timedelta(hours=1) if runs_out_at else now + timedelta(hours=3)
            recheck_at = min(max(target, now + timedelta(minutes=30)), now + timedelta(hours=3))
            if level == Status.OK_FOR_NOW:
                reason = f"{reason}. Calling again at {_clock(recheck_at)}"
        return Decision(level, rule_id, reason, hours, spare, runs_out_at, recheck_at)

    if facts.emergency:
        return decide(Status.HELP_NOW, "R0", "Said it's an emergency")
    if facts.safe == "no":
        return decide(Status.HELP_NOW, "R0", "Said they're not safe")
    if facts.device_working == "no" and facts.backup_left == 0:
        return decide(Status.HELP_NOW, "R1", "Device off, no backups left")
    if spare is not None and spare < 1:
        if drive_minutes is None:
            reason = f"{_minutes(spare)} min to spare (drive time unknown)"
        else:
            reason = f"Hospital {round(drive_minutes)} min away, {_minutes(spare)} min to spare"
        return decide(Status.HELP_NOW, "R2", reason)
    if facts.backup_left == 1:
        return decide(Status.HELP_SOON, "R3", "1 backup left")
    if hours is not None and hours < 4:
        return decide(Status.HELP_SOON, "R3", f"{hours:g} h left")
    if facts.confidence < 0.7 or (resident.device_group == 1 and hours is None):
        return decide(Status.PERSON_CHECK, "R4", "Answers unclear")
    if facts.needs:
        needs = ", ".join(NEED_WORDS[n] for n in facts.needs)
        return decide(Status.NEEDS_SUPPLIES, "R5", f"Needs {needs}", recheck=True)
    return decide(Status.OK_FOR_NOW, "R6", "Enough supply", recheck=True)


def no_answer_decision(missed_calls: int) -> Decision:
    """Rule NA: no result after 2 calls. Set by the calling code, not from Bedrock."""
    return Decision(Status.HELP_SOON, "NA", f"No answer ({missed_calls} tries). Send a welfare check",
                    None, None, None, None)
