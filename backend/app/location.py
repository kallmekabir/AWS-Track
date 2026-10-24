"""Amazon Location geocoding and cached hospital-to-resident drive times.

CSV coordinates are already geocoded. All AWS positions are [longitude, latitude].
No AWS clients or calls are made at import time or by dashboard polling requests.
"""
import csv
import hashlib
import json
import math
import os
import time
from collections import OrderedDict
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from threading import Lock

import boto3
from botocore.config import Config
from pydantic import ValidationError

from app.models import Hospital, HospitalRoute, Resident, ResidentIn, RouteGeometry

DEFAULT_HOSPITALS_CSV = Path(__file__).resolve().parents[2] / "data" / "Hospital_clean.csv"
LOCATION_FIELDS = ("drive_minutes", "nearest_hospital_id", "location_cache_key", "location_updated_at")
ROUTE_CACHE_SECONDS = 15 * 60
_route_cache: OrderedDict[tuple, tuple[float, HospitalRoute]] = OrderedDict()
_route_cache_lock = Lock()


class LocationError(ValueError):
    pass


class LocationNotConfigured(LocationError):
    pass


def enabled() -> bool:
    return os.getenv("LOCATION_ENABLED", "0") == "1"


def require_enabled() -> None:
    if not enabled():
        raise LocationNotConfigured("Set LOCATION_ENABLED=1 to geocode addresses and calculate hospital drives")


def load_hospitals(path: Path | None = None) -> list[Hospital]:
    path = path or Path(os.getenv("HOSPITALS_CSV") or DEFAULT_HOSPITALS_CSV)
    try:
        with path.open(newline="", encoding="utf-8-sig") as source:
            reader = csv.DictReader(source)
            if reader.fieldnames != ["id", "name", "address", "lat", "lng"]:
                raise LocationError("Hospital CSV must have header id,name,address,lat,lng")
            hospitals = []
            seen = set()
            for row in reader:
                if None in row or any(value is None for value in row.values()):
                    raise LocationError(f"Hospital CSV row {reader.line_num}: incorrect column count")
                try:
                    hospital = Hospital.model_validate({k: v.strip() for k, v in row.items()})
                except ValidationError:
                    raise LocationError(f"Hospital CSV row {reader.line_num}: invalid hospital or coordinates") from None
                if hospital.id in seen:
                    raise LocationError(f"Hospital CSV row {reader.line_num}: duplicate hospital id")
                seen.add(hospital.id)
                hospitals.append(hospital)
    except (OSError, csv.Error) as exc:
        raise LocationError("Cannot read hospital CSV; check HOSPITALS_CSV and include data/ in deployment") from exc
    if not hospitals:
        raise LocationError("Hospital CSV has no hospitals")
    return hospitals


@lru_cache(maxsize=4)
def _client(service: str, region: str):
    return boto3.client(service, region_name=region, config=Config(
        retries={"mode": "standard", "total_max_attempts": 2},
        connect_timeout=5, read_timeout=20))


def _region() -> str:
    return os.getenv("AWS_DEFAULT_REGION") or os.getenv("AWS_REGION") or "us-east-1"


def resolve_position(resident: ResidentIn) -> ResidentIn:
    """Keep supplied coordinates; geocode only when both are omitted."""
    if resident.lat is not None and resident.lng is not None:
        return resident
    require_enabled()
    response = _client("geo-places", _region()).geocode(
        QueryText=resident.address, MaxResults=1, IntendedUse="Storage",
        Filter={"IncludeCountries": ["USA"],
                "IncludePlaceTypes": ["PointAddress", "InterpolatedAddress", "SecondaryAddress"]})
    items = response.get("ResultItems", [])
    if not items:
        raise LocationError("Address could not be geocoded; supply a full address or lat and lng")
    position = items[0].get("Position", [])
    if len(position) != 2:
        raise LocationError("Amazon Location returned an invalid position")
    try:
        return ResidentIn.model_validate({**resident.model_dump(), "lng": position[0], "lat": position[1]})
    except ValidationError:
        raise LocationError("Amazon Location returned invalid coordinates") from None


def _cache_key(resident: ResidentIn, hospitals: list[Hospital]) -> str:
    payload = {"position": [resident.lng, resident.lat], "address": resident.address,
               "hospitals": [h.model_dump() for h in hospitals], "region": _region(),
               "mode": "Car", "traffic": "DepartNow"}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def drive_times(residents: list[ResidentIn], *, force: bool = False) -> list[dict]:
    """Return location fields in input order. Successful cached results skip AWS.

    Unbounded matrices allow 15 origins and 100 pairs per request. Batch both
    dimensions, keeping every hospital eligible. Cell errors never mean zero time.
    """
    require_enabled()
    hospitals = load_hospitals()
    keys = [_cache_key(r, hospitals) for r in residents]
    results = [{field: getattr(r, field, None) for field in LOCATION_FIELDS} for r in residents]
    pending = [i for i, r in enumerate(residents) if force or not (
        isinstance(r, Resident) and r.location_cache_key == keys[i]
        and r.drive_minutes is not None and r.nearest_hospital_id is not None)]
    if not pending:
        return results
    if any(residents[i].lat is None or residents[i].lng is None for i in pending):
        raise LocationError("Resolve resident positions before calculating drives")
    best: dict[int, tuple[float, str]] = {}
    client = _client("geo-routes", _region())
    for origin_offset in range(0, len(hospitals), 15):
        origins = hospitals[origin_offset:origin_offset + 15]
        batch_size = 100 // len(origins)
        for offset in range(0, len(pending), batch_size):
            indices = pending[offset:offset + batch_size]
            response = client.calculate_route_matrix(
                Origins=[{"Position": [h.lng, h.lat]} for h in origins],
                Destinations=[{"Position": [residents[i].lng, residents[i].lat]} for i in indices],
                TravelMode="Car", DepartNow=True, RoutingBoundary={"Unbounded": True})
            matrix = response.get("RouteMatrix", [])
            if len(matrix) != len(origins) or any(len(row) != len(indices) for row in matrix):
                raise LocationError("Amazon Location returned an incomplete route matrix")
            for hospital, row in zip(origins, matrix):
                for index, cell in zip(indices, row):
                    duration = cell.get("Duration")
                    if (cell.get("Error") or isinstance(duration, bool)
                            or not isinstance(duration, (int, float))
                            or not math.isfinite(duration) or duration < 0):
                        continue
                    candidate = (duration / 60, hospital.id)
                    if index not in best or candidate < best[index]:
                        best[index] = candidate
    now = datetime.now(timezone.utc)
    for i in pending:
        minutes, hospital_id = best.get(i, (None, None))
        results[i] = dict(drive_minutes=minutes, nearest_hospital_id=hospital_id,
                          location_cache_key=keys[i] if minutes is not None else None,
                          location_updated_at=now)
    return results


def hospital_route(resident: Resident) -> HospitalRoute:
    """Draw the drive to the stored nearest hospital; resolve it if not yet known.

    This resident-to-hospital trip is separate from the cached delivery estimate
    used for ranking. Selection never writes over that hospital-to-resident time.
    """
    require_enabled()
    hospitals = load_hospitals()
    key = (resident.id, _cache_key(resident, hospitals), resident.nearest_hospital_id)
    with _route_cache_lock:
        cached = _route_cache.get(key)
        if cached and time.monotonic() - cached[0] < ROUTE_CACHE_SECONDS:
            return cached[1]

    hospital = next((h for h in hospitals if h.id == resident.nearest_hospital_id), None)
    if hospital is None:
        nearest_id = drive_times([resident])[0]["nearest_hospital_id"]
        hospital = next((h for h in hospitals if h.id == nearest_id), None)
    if hospital is None:
        raise LocationError("No reachable hospital route is available for this resident")

    response = _client("geo-routes", _region()).calculate_routes(
        Origin=[resident.lng, resident.lat], Destination=[hospital.lng, hospital.lat],
        TravelMode="Car", DepartNow=True, Traffic={"Usage": "UseTrafficData"},
        LegGeometryFormat="Simple")
    routes = response.get("Routes", [])
    if not routes:
        raise LocationError("No driving route to this hospital is available")
    route = routes[0]
    coordinates = []
    for leg in route.get("Legs", []):
        line = leg.get("Geometry", {}).get("LineString", [])
        if len(line) < 2:
            raise LocationError("Amazon Location returned incomplete route geometry")
        coordinates.extend(line[1:] if coordinates and coordinates[-1] == line[0] else line)
    try:
        result = HospitalRoute(
            resident_id=resident.id, hospital=hospital,
            drive_minutes=route["Summary"]["Duration"] / 60,
            distance_km=route["Summary"]["Distance"] / 1000,
            computed_at=datetime.now(timezone.utc),
            geometry=RouteGeometry(coordinates=coordinates))
    except (KeyError, TypeError, ValidationError):
        raise LocationError("Amazon Location returned an incomplete route") from None
    with _route_cache_lock:
        _route_cache[key] = (time.monotonic(), result)
        _route_cache.move_to_end(key)
        while len(_route_cache) > 128:
            _route_cache.popitem(last=False)
    return result
