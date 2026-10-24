"""Write residents to the store (DynamoDB when RESIDENTS_TABLE is set in backend/.env).

Two sources; pick one. Run from backend/:

    python -m app.seed --demo     # the 8-person ROSTER below; teammates' phones can ring
    python -m app.seed            # data/Residents_simple.csv (or RESIDENTS_CSV); nobody callable
    python -m app.seed --csv /path/to/residents.csv

Add --dry-run to validate without writing, or --with-location to calculate hospital
drive times first (needs LOCATION_ENABLED=1).

--demo: the roster matches the worked example in docs/RANKING.md. Teammates play the
four group 1 personas (Daniel, Ruth, Maria, Linh). Each teammate stores their own
number, with their OK, in Parameter Store (see app/phones.py):

    /carecall/phones/daniel-kim     +14085551234      (SecureString)

Fallback for offline work: backend/seed.local.json, which git ignores:

    [{"name": "Daniel Kim", "phone": "+14085551234"}, ...]

Each number gives that persona the phone and allow_call=True.

CSV: allow_call and phones are used exactly as written; Parameter Store is never read.
Rows are validated before any writes, and CSV ids are preserved.

Both sources use ids from r-001, and matching residents are replaced, including their
live outage state.
"""
import argparse
import csv
import json
import math
import os
import re
import sys
from pathlib import Path

from pydantic import ValidationError

from app import phones as phone_store
from app.models import Resident, ResidentIn, mask_phone

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CSV_PATH = BACKEND_DIR.parent / "data" / "Residents_simple.csv"
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

# Demo drive times (minutes) from the nearest supplier, by persona. In production these
# come from the Amazon Location route matrix; for the demo they live in the registry so
# the worked example in docs/RANKING.md is reproducible without AWS Location.
DRIVE_MINUTES = {
    "Daniel Kim": 25, "Ruth Okafor": 70, "Maria Lopez": 15, "Linh Tran": 20,
    "Samuel Reyes": 30, "Alice Moore": 40, "George Patel": 20, "Henry Wu": 35,
}


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
        residents.append(Resident(id=f"r-{i:03d}", drive_minutes=DRIVE_MINUTES.get(row.name), **data))
    return residents


def load_csv_residents(path: Path) -> list[Resident]:
    """Validate the whole CSV before writing anything, preserving its resident ids."""
    required = {"id", "name", "phone", "address", "lat", "lng", "device"}
    allowed = set(ResidentIn.model_fields) | {"id"}
    optional = {"device_group", "backups_on_file", "backup_hours_each"}
    residents = []
    seen = set()
    with path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        headers = reader.fieldnames or []
        if len(headers) != len(set(headers)):
            raise ValueError(f"{path.name}: duplicate column names")
        missing = required - set(headers)
        if missing:
            raise ValueError(f"{path.name}: missing columns: {', '.join(sorted(missing))}")
        unknown = set(headers) - allowed
        if unknown:
            raise ValueError(f"{path.name}: unknown columns: {', '.join(sorted(unknown))}")
        for row in reader:
            location = f"{path.name}: row {reader.line_num}"
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"{location}: column count does not match header")
            data = {key: value.strip() for key, value in row.items()}
            for key in optional:
                if data.get(key) == "":
                    del data[key]
            for key in required:
                if not data[key]:
                    raise ValueError(f"{location}: {key} is required")
            if not re.fullmatch(r"r-[0-9]+", data["id"]):
                raise ValueError(f"{location}: id must have the form r-001")
            if data["id"] in seen:
                raise ValueError(f"{location}: duplicate resident id")
            try:
                resident = Resident.model_validate(data)
            except ValidationError as exc:
                # Report fields and reasons without echoing phone numbers or row data.
                if any(error["loc"] in (("lat",), ("lng",)) and error["type"] in
                       {"less_than_equal", "greater_than_equal", "finite_number"}
                       for error in exc.errors(include_input=False)):
                    raise ValueError(f"{location}: latitude or longitude is out of range") from None
                details = "; ".join(
                    f"{'.'.join(map(str, error['loc']))}: {error['msg']}"
                    for error in exc.errors(include_input=False)
                )
                raise ValueError(f"{location}: {details}") from None
            if not (-90 <= resident.lat <= 90 and -180 <= resident.lng <= 180):
                raise ValueError(f"{location}: latitude or longitude is out of range")
            if resident.backup_hours_each is not None and not math.isfinite(resident.backup_hours_each):
                raise ValueError(f"{location}: backup_hours_each must be finite")
            seen.add(resident.id)
            residents.append(resident)
    if not residents:
        raise ValueError(f"{path.name}: no residents found")
    return residents


def main(argv: list[str] | None = None) -> int:
    try:
        from dotenv import load_dotenv  # also installed with the server runtime
        load_dotenv(BACKEND_DIR / ".env")
    except ImportError:
        pass
    parser = argparse.ArgumentParser(description="Seed residents from a CSV file.")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--csv", type=Path, help="Resident CSV (default: RESIDENTS_CSV or data/Residents_simple.csv)")
    source.add_argument("--demo", action="store_true", help="Seed the original demo roster instead")
    parser.add_argument("--dry-run", action="store_true", help="Validate and count residents without writing")
    parser.add_argument("--with-location", action="store_true", help="Calculate hospital drives before writing (requires LOCATION_ENABLED=1)")
    args = parser.parse_args(argv)

    try:
        residents = (seed_residents() if args.demo else load_csv_residents(
            args.csv or Path(os.getenv("RESIDENTS_CSV") or DEFAULT_CSV_PATH)))
    except (OSError, ValueError, csv.Error) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    if args.dry_run:
        print(f"Validated {len(residents)} residents; no data written.")
        return 0

    if args.with_location:
        from app import location
        from botocore.exceptions import BotoCoreError, ClientError
        # Calculate the entire batch before writing any residents.
        try:
            residents = [r.model_copy(update=fields) for r, fields in
                         zip(residents, location.drive_times(residents))]
        except (location.LocationError, BotoCoreError, ClientError):
            print("Error: hospital drive calculation failed; no residents written. "
                  "Check LOCATION_ENABLED, HOSPITALS_CSV and backend AWS access.", file=sys.stderr)
            return 1

    from app import store  # imported after validation and .env loading

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
