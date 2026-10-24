"""Ranking rules from docs/RANKING.md.

Plain Python with no AWS calls, so the eval can test it without the internet.
Round 1 (who do we call first?) lives here now. Round 2 (who do we help first?)
comes in Phase 2.
"""

# Words in `device` that put it in group 1 or 2 (docs/RANKING.md, "Device groups").
_GROUP_1_WORDS = ("oxygen", "ventilator")
_GROUP_2_WORDS = ("dialysis", "infusion")


def device_group_for(device: str) -> int:
    """Work out the device group when the agency didn't set one. Unknown devices are group 3."""
    device = device.lower()
    if any(word in device for word in _GROUP_1_WORDS):
        return 1
    if any(word in device for word in _GROUP_2_WORDS):
        return 2
    return 3


def round1_key(r) -> tuple:
    """Round 1 calling order key: device group, then fewest backups on file (unknown
    counts as 0), then id. Reused by store.queue() so not-yet-called residents show in
    the order they'll be called."""
    return (r.device_group or 3, r.backups_on_file or 0, r.id)


def round1_order(residents: list) -> list:
    """Calling order: device group, then fewest backups on file (unknown counts as 0), then id."""
    return sorted(residents, key=round1_key)
