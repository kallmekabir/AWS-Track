import csv
import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from boto3.dynamodb.types import TypeSerializer

from app import seed, store


class CsvSeedTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "residents.csv"
        self.row = dict(
            id="r-025", name="Test Resident", phone="+14085550151",
            address="123 Main St, San Jose, CA", lat="37.2", lng="-121.8",
            device="Oxygen concentrator", device_group="", backups_on_file="0",
            backup_hours_each="", allow_call="false",
        )

    def write_csv(self, *rows):
        with self.path.open("w", newline="", encoding="utf-8-sig") as target:
            writer = csv.DictWriter(target, fieldnames=self.row)
            writer.writeheader()
            writer.writerows(rows)

    def test_loads_typed_values_defaults_and_quoted_address(self):
        self.write_csv(self.row)
        resident, = seed.load_csv_residents(self.path)
        self.assertEqual(resident.id, "r-025")
        self.assertEqual(resident.address, self.row["address"])
        self.assertEqual(resident.lat, 37.2)
        self.assertEqual(resident.device_group, 1)
        self.assertEqual(resident.backups_on_file, 0)
        self.assertIsNone(resident.backup_hours_each)
        self.assertFalse(resident.allow_call)

    def test_rejects_duplicate_ids(self):
        self.write_csv(self.row, self.row)
        with self.assertRaisesRegex(ValueError, "row 3: duplicate resident id"):
            seed.load_csv_residents(self.path)

    def test_reports_invalid_field_without_phone_value(self):
        self.write_csv({**self.row, "phone": "invalid-private-number"})
        with self.assertRaisesRegex(ValueError, "row 2: phone") as error:
            seed.load_csv_residents(self.path)
        self.assertNotIn("invalid-private-number", str(error.exception))

    def test_rejects_missing_headers_empty_data_and_invalid_coordinates(self):
        self.path.write_text("id,name\nr-001,Test\n")
        with self.assertRaisesRegex(ValueError, "missing columns"):
            seed.load_csv_residents(self.path)
        self.write_csv()
        with self.assertRaisesRegex(ValueError, "no residents"):
            seed.load_csv_residents(self.path)
        self.write_csv({**self.row, "lat": "nan"})
        with self.assertRaisesRegex(ValueError, "out of range"):
            seed.load_csv_residents(self.path)

    def test_dry_run_does_not_write(self):
        self.write_csv(self.row)
        with patch.object(store, "save_resident") as save, redirect_stdout(io.StringIO()):
            self.assertEqual(seed.main(["--csv", str(self.path), "--dry-run"]), 0)
        save.assert_not_called()

    def test_rejects_ids_that_break_new_resident_id_allocation(self):
        self.write_csv({**self.row, "id": "r-invalid"})
        with self.assertRaisesRegex(ValueError, "id must have the form"):
            seed.load_csv_residents(self.path)

    def test_rejects_infinite_backup_hours_before_dynamodb_write(self):
        self.write_csv({**self.row, "backup_hours_each": "inf"})
        with self.assertRaisesRegex(ValueError, "backup_hours_each must be finite"):
            seed.load_csv_residents(self.path)

    def test_validates_all_rows_before_writing(self):
        self.write_csv(self.row, {**self.row, "id": "r-026", "allow_call": "maybe"})
        with patch.object(store, "save_resident") as save, redirect_stderr(io.StringIO()):
            self.assertEqual(seed.main(["--csv", str(self.path)]), 1)
        save.assert_not_called()

    def test_seeds_using_csv_ids(self):
        self.write_csv(self.row)
        with patch.object(store, "save_resident") as save, redirect_stdout(io.StringIO()):
            self.assertEqual(seed.main(["--csv", str(self.path)]), 0)
        save.assert_called_once()
        self.assertEqual(save.call_args.args[0].id, "r-025")

    def test_csv_resident_round_trips_through_dynamodb_backend(self):
        self.write_csv(self.row)
        with patch("app.store.boto3.resource") as resource:
            backend = store._DynamoBackend("residents", "checkins")
        with patch.object(store, "_backend", backend), redirect_stdout(io.StringIO()):
            self.assertEqual(seed.main(["--csv", str(self.path)]), 0)
            item = backend.residents.put_item.call_args.kwargs["Item"]
            self.assertEqual(item["id"], "r-025")
            self.assertEqual(item["lat"], Decimal("37.2"))
            self.assertIs(item["allow_call"], False)
            self.assertIsNotNone(item["updated_at"])
            # Exercise boto3's real serializer, including numbers, nulls and booleans.
            TypeSerializer().serialize(item)
            backend.residents.get_item.return_value = {"Item": item}
            resident = store.get_resident("r-025")
            self.assertEqual(resident.lat, 37.2)
            self.assertEqual(resident.name, self.row["name"])
            self.assertIsNotNone(resident.updated_at)


if __name__ == "__main__":
    unittest.main()
