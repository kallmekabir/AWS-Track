"""The demo roster: made-up residents, plus teammates' real phones.

The roster matches the worked example in docs/RANKING.md. Teammates play the four
group 1 personas (Daniel, Ruth, Maria, Linh). Each teammate stores their own number,
with their OK, in Parameter Store (see app/phones.py):

    /carecall/phones/daniel-kim     +14085551234      (SecureString)

Fallback for offline work: backend/seed.local.json, which git ignores:

    [{"name": "Daniel Kim", "phone": "+14085551234"}, ...]

Each number gives that persona the phone and allow_call=True.

Write the roster to the store (DynamoDB when RESIDENTS_TABLE is set in backend/.env):

    python -m app.seed
"""
import json
import os
import sys
from pathlib import Path

from app import phones as phone_store
from app.models import Resident, ResidentIn, mask_phone

BACKEND_DIR = Path(__file__).resolve().parent.parent
LOCAL_SEED_PATH = Path(os.getenv("SEED_LOCAL_PATH", BACKEND_DIR / "seed.local.json"))

# All made up. Phones are 555 numbers that are never on the dialer allow-list.
ROSTER = [
    ResidentIn(name="Daniel Kim", phone="+14085550102", address="88 Oak Ave, San Jose, CA",
               lat=37.342, lng=-121.889, device="Home ventilator",
               backups_on_file=0, backup_hours_each=4),
    ResidentIn(name="Ruth Okafor", phone="+14085550103", address="9 Birch Ct, San Jose, CA",
               lat=37.338, lng=-121.886, device="Oxygen concentrator",
               backups_on_file=1, backup_hours_each=2),
    ResidentIn(name="Maria Lopez", phone="+14085550101", address="412 Elm St, San Jose, CA",
               lat=37.335, lng=-121.893, device="Oxygen concentrator",
               backups_on_file=2, backup_hours_each=2),
    ResidentIn(name="Linh Tran", phone="+14085550121", address="57 Maple Dr, San Jose, CA",
               lat=37.329, lng=-121.890, device="Oxygen concentrator",
               backups_on_file=3, backup_hours_each=3),
    ResidentIn(name="Samuel Reyes", phone="+14085550114", address="230 Cedar Ln, San Jose, CA",
               lat=37.331, lng=-121.897, device="Home dialysis",
               backups_on_file=1, backup_hours_each=4),
    ResidentIn(name="Alice Moore", phone="+14085550109", address="301 Pine St, San Jose, CA",
               lat=37.344, lng=-121.895, device="Infusion pump",
               backups_on_file=2, backup_hours_each=6),
    ResidentIn(name="George Patel", phone="+14085550127", address="16 Walnut St, San Jose, CA",
               lat=37.340, lng=-121.881, device="CPAP machine",
               backups_on_file=1, backup_hours_each=8),
    ResidentIn(name="Henry Wu", phone="+14085550133", address="74 Spruce Ave, San Jose, CA",
               lat=37.328, lng=-121.884, device="Powered wheelchair",
               backups_on_file=1, backup_hours_each=10),
]


def load_local_phones(path: Path = LOCAL_SEED_PATH) -> dict[str, str]:
    """Read seed.local.json into {persona name: teammate phone}. Missing file means no teammates."""
    if not path.exists():
        return {}
    entries = json.loads(path.read_text())
    names = {r.name for r in ROSTER}
    phones = {}
    for entry in entries:
        if entry["name"] not in names:
            raise ValueError(f"{path.name}: '{entry['name']}' is not in the roster ({', '.join(sorted(names))})")
        phones[entry["name"]] = entry["phone"]
    return phones


def load_ssm_phones() -> dict[str, str]:
    """Parameter Store numbers as {persona name: teammate phone}."""
    by_slug = {phone_store.slug(r.name): r.name for r in ROSTER}
    phones = {}
    for key, phone in phone_store.load().items():
        if key not in by_slug:
            raise ValueError(f"Parameter '{key}' is not a persona; use one of {', '.join(sorted(by_slug))}")
        phones[by_slug[key]] = phone
    return phones


def seed_residents(path: Path = LOCAL_SEED_PATH) -> list[Resident]:
    """The roster with ids r-001, r-002, ... in order, teammates' phones applied
    (Parameter Store wins over seed.local.json)."""
    phones = {**load_local_phones(path), **load_ssm_phones()}
    residents = []
    for i, row in enumerate(ROSTER, start=1):
        data = row.model_dump()
        if row.name in phones:
            data.update(phone=phones[row.name], allow_call=True)
        residents.append(Resident(id=f"r-{i:03d}", **data))
    return residents


def main() -> int:
    try:
        from dotenv import load_dotenv  # dev-only package; Lambda never runs this file
        load_dotenv(BACKEND_DIR / ".env")
    except ImportError:
        pass
    from app import store  # imported after .env is loaded, so it sees RESIDENTS_TABLE

    try:
        residents = seed_residents()
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    for resident in residents:
        store.save_resident(resident)
    where = os.getenv("RESIDENTS_TABLE") or "memory (RESIDENTS_TABLE not set, nothing was saved)"
    print(f"Seeded {len(residents)} residents into {where}.")
    for r in residents:
        if r.allow_call:  # masked: full numbers are never printed
            print(f"  callable: {r.name} {mask_phone(r.phone)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
