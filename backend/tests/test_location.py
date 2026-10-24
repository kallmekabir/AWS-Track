import asyncio
import csv
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import boto3
from botocore import UNSIGNED
from botocore.config import Config
from botocore.exceptions import ClientError
from botocore.stub import Stubber
from fastapi import HTTPException
from pydantic import ValidationError

from app import location, main, seed, store
from app.models import HospitalRoute, Resident, ResidentIn, ResidentPatch, Status


def route_response():
    return {
        'LegGeometryFormat': 'Simple', 'Notices': [], 'PricingBucket': 'Core',
        'Routes': [{
            'MajorRoadLabels': [], 'Summary': {'Duration': 450, 'Distance': 3500},
            'Legs': [{'Type': 'Vehicle', 'TravelMode': 'Car', 'Geometry': {
                'LineString': [[-121.9, 37.3], [-121.92, 37.31]]}},
                {'Type': 'Vehicle', 'TravelMode': 'Car', 'Geometry': {
                    'LineString': [[-121.92, 37.31], [-121.938534, 37.316157]]}}]}]}


class LocationTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict('os.environ', {
            'LOCATION_ENABLED': '1', 'AWS_DEFAULT_REGION': 'us-east-1', 'HOSPITALS_CSV': ''})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.hospitals = location.load_hospitals()
        self.resident = Resident(id='r-001', **seed.ROSTER[0].model_dump())
        location._route_cache.clear()
        self.addCleanup(location._route_cache.clear)
        self.routes = mock.Mock()
        self.places = mock.Mock()
        self.client = mock.patch.object(location, '_client', side_effect=lambda service, region:
                                        self.routes if service == 'geo-routes' else self.places)
        self.client.start()
        self.addCleanup(self.client.stop)

    def matrix(self, durations):
        self.routes.calculate_route_matrix.return_value = {
            'RouteMatrix': [[{'Duration': seconds} if seconds is not None else
                             {'Error': 'NoRoute', 'Duration': 0} for seconds in row]
                            for row in durations]}

    def test_loads_all_six_hospitals_without_geocoding(self):
        self.assertEqual(len(self.hospitals), 6)
        self.assertEqual(self.hospitals[0].name, 'Good Samaritan Hospital')
        self.assertEqual(self.hospitals[1].lng, -121.938534)
        self.places.geocode.assert_not_called()

    def test_csv_rejects_bad_coordinates_duplicate_ids_and_empty_data(self):
        for rows in [[], [('s-1', 'Hospital', 'Address', 'nan', '-121')],
                     [('s-1', 'Hospital', 'Address', '37', '-121')] * 2]:
            with self.subTest(rows=rows), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'hospitals.csv'
                with path.open('w', newline='') as target:
                    writer = csv.writer(target)
                    writer.writerow(['id', 'name', 'address', 'lat', 'lng'])
                    writer.writerows(rows)
                with self.assertRaises(location.LocationError):
                    location.load_hospitals(path)

    def test_geocodes_with_storage_and_longitude_first(self):
        body = ResidentIn.model_validate({**seed.ROSTER[0].model_dump(), 'lat': None, 'lng': None})
        self.places.geocode.return_value = {'ResultItems': [{'Position': [-121.9, 37.3]}]}
        result = location.resolve_position(body)
        self.assertEqual((result.lat, result.lng), (37.3, -121.9))
        self.assertEqual(self.places.geocode.call_args.kwargs['IntendedUse'], 'Storage')
        self.assertIs(location.resolve_position(self.resident), self.resident)
        self.assertEqual(self.places.geocode.call_count, 1)

    def test_missing_geocode_match_and_invalid_coordinate_pair_are_rejected(self):
        body = ResidentIn.model_validate({**seed.ROSTER[0].model_dump(), 'lat': None, 'lng': None})
        self.places.geocode.return_value = {'ResultItems': []}
        with self.assertRaises(location.LocationError):
            location.resolve_position(body)
        for fields in [{'lat': None}, {'lat': 100}, {'lng': float('inf')}]:
            with self.subTest(fields=fields), self.assertRaises(ValidationError):
                ResidentIn.model_validate({**seed.ROSTER[0].model_dump(), **fields})

    def test_shortest_valid_drive_per_destination_and_seconds_conversion(self):
        second = self.resident.model_copy(update={'id': 'r-002', 'lng': -121.8})
        self.matrix([[600, 180], [None, 300], [120, 60], [180, 90], [300, 120], [360, 240]])
        results = location.drive_times([self.resident, second])
        self.assertEqual([r['drive_minutes'] for r in results], [2, 1])
        self.assertEqual([r['nearest_hospital_id'] for r in results], ['s-003', 's-003'])
        request = self.routes.calculate_route_matrix.call_args.kwargs
        self.assertEqual(request['Origins'][0], {'Position': [-121.945634, 37.252319]})
        self.assertEqual(request['Destinations'][1], {'Position': [-121.8, second.lat]})
        self.assertTrue(request['DepartNow'])

    def test_real_sdk_validates_route_and_geocode_request_shapes(self):
        # Unsigned clients and Stubber validate against installed AWS models, offline.
        routes = boto3.client('geo-routes', region_name='us-east-1', config=Config(signature_version=UNSIGNED))
        places = boto3.client('geo-places', region_name='us-east-1', config=Config(signature_version=UNSIGNED))
        self.addCleanup(routes.close)
        self.addCleanup(places.close)
        with Stubber(routes) as routing, Stubber(places) as geocoding:
            geocoding.add_response('geocode', {'PricingBucket': 'Core', 'ResultItems': [{
                'PlaceId': 'test-place', 'PlaceType': 'PointAddress', 'Title': 'Test address',
                'Position': [-121.9, 37.3]}]})
            routing.add_response('calculate_route_matrix', {
                'ErrorCount': 0, 'PricingBucket': 'Core', 'RoutingBoundary': {'Unbounded': True},
                'RouteMatrix': [[{'Duration': 61, 'Distance': 1000}]] * 6})
            with mock.patch.object(location, '_client', side_effect=lambda service, region:
                                   routes if service == 'geo-routes' else places):
                body = ResidentIn.model_validate({**seed.ROSTER[0].model_dump(), 'lat': None, 'lng': None})
                resolved = location.resolve_position(body)
                self.assertAlmostEqual(location.drive_times([resolved])[0]['drive_minutes'], 61 / 60)
            routing.assert_no_pending_responses()
            geocoding.assert_no_pending_responses()

    def test_no_route_stays_unknown_and_is_retried(self):
        self.matrix([[None]] * 6)
        fields = location.drive_times([self.resident])[0]
        self.assertIsNone(fields['drive_minutes'])
        self.assertIsNone(fields['nearest_hospital_id'])
        self.assertIsNone(fields['location_cache_key'])
        location.drive_times([self.resident.model_copy(update=fields)])
        self.assertEqual(self.routes.calculate_route_matrix.call_count, 2)

    def test_cache_reused_and_invalidated_by_position_hospitals_or_force(self):
        self.matrix([[60]] * 6)
        cached = self.resident.model_copy(update=location.drive_times([self.resident])[0])
        location.drive_times([cached])
        self.assertEqual(self.routes.calculate_route_matrix.call_count, 1)
        location.drive_times([cached], force=True)
        location.drive_times([cached.model_copy(update={'lat': cached.lat + .01})])
        changed = [h.model_copy() for h in self.hospitals]
        changed[0].lng += .01
        with mock.patch.object(location, 'load_hospitals', return_value=changed):
            location.drive_times([cached])
        self.assertEqual(self.routes.calculate_route_matrix.call_count, 4)

    def test_batches_do_not_exceed_unbounded_matrix_limits(self):
        def respond(**kwargs):
            self.assertLessEqual(len(kwargs['Origins']), 15)
            self.assertLessEqual(len(kwargs['Origins']) * len(kwargs['Destinations']), 100)
            return {'RouteMatrix': [[{'Duration': 120}] * len(kwargs['Destinations'])
                                    for _ in kwargs['Origins']]}
        self.routes.calculate_route_matrix.side_effect = respond
        residents = [self.resident.model_copy(update={'id': f'r-{i:03d}'}) for i in range(40)]
        results = location.drive_times(residents)
        self.assertEqual(len(results), 40)
        self.assertTrue(all(r['drive_minutes'] == 2 for r in results))
        self.assertEqual(self.routes.calculate_route_matrix.call_count, 3)

    def test_malformed_matrix_is_rejected(self):
        self.routes.calculate_route_matrix.return_value = {'RouteMatrix': []}
        with self.assertRaises(location.LocationError):
            location.drive_times([self.resident])

    def test_hospital_route_uses_stored_hospital_and_converts_geometry_and_units(self):
        self.routes.calculate_routes.return_value = route_response()
        resident = self.resident.model_copy(update={'nearest_hospital_id': 's-002', 'drive_minutes': 12})
        result = location.hospital_route(resident)
        self.assertEqual(result.hospital.id, 's-002')
        self.assertEqual(result.drive_minutes, 7.5)
        self.assertEqual(result.distance_km, 3.5)
        self.assertEqual(result.basis, 'live_traffic')
        self.assertEqual(len(result.geometry.coordinates), 3)
        self.assertEqual(result.geometry.coordinates[0], (-121.9, 37.3))
        self.assertEqual(resident.drive_minutes, 12)
        self.routes.calculate_route_matrix.assert_not_called()
        self.routes.calculate_routes.assert_called_once_with(
            Origin=[resident.lng, resident.lat],
            Destination=[self.hospitals[1].lng, self.hospitals[1].lat],
            TravelMode='Car', DepartNow=True, Traffic={'Usage': 'UseTrafficData'},
            LegGeometryFormat='Simple')

    def test_hospital_route_resolves_missing_or_removed_hospital_using_existing_matrix(self):
        self.matrix([[600], [120], [300], [400], [500], [600]])
        self.routes.calculate_routes.return_value = route_response()
        for hospital_id in [None, 'removed-hospital']:
            with self.subTest(hospital_id=hospital_id):
                result = location.hospital_route(self.resident.model_copy(update={
                    'nearest_hospital_id': hospital_id}))
                self.assertEqual(result.hospital.id, 's-002')
        self.assertEqual(self.routes.calculate_route_matrix.call_count, 2)

    def test_hospital_route_cache_reused_expires_and_invalidates_when_locations_change(self):
        self.matrix([[120]] * 6)
        self.routes.calculate_routes.return_value = route_response()
        with mock.patch.object(location.time, 'monotonic', return_value=100):
            first = location.hospital_route(self.resident)
            self.assertEqual(location.hospital_route(self.resident), first)
        self.assertEqual(self.routes.calculate_route_matrix.call_count, 1)
        self.assertEqual(self.routes.calculate_routes.call_count, 1)
        with mock.patch.object(location.time, 'monotonic', return_value=100 + location.ROUTE_CACHE_SECONDS):
            location.hospital_route(self.resident)
        location.hospital_route(self.resident.model_copy(update={'lng': -121.8}))
        location.hospital_route(self.resident.model_copy(update={'nearest_hospital_id': 's-002'}))
        changed = [h.model_copy() for h in self.hospitals]
        changed[0].lng += .01
        with mock.patch.object(location, 'load_hospitals', return_value=changed):
            location.hospital_route(self.resident)
        self.assertEqual(self.routes.calculate_routes.call_count, 5)

    def test_hospital_route_rejects_unreachable_and_incomplete_routes_without_caching(self):
        self.matrix([[None]] * 6)
        with self.assertRaises(location.LocationError):
            location.hospital_route(self.resident)
        self.routes.calculate_routes.assert_not_called()
        resident = self.resident.model_copy(update={'nearest_hospital_id': 's-002'})
        malformed = [
            {'Routes': []},
            {'Routes': [{'Legs': []}]},
            {'Routes': [{'Legs': [{'Geometry': {}}]}]},
            {'Routes': [{**route_response()['Routes'][0], 'Summary': {'Duration': -1, 'Distance': 1}}]},
        ]
        for response in malformed:
            with self.subTest(response=response), self.assertRaises(location.LocationError):
                self.routes.calculate_routes.return_value = response
                location.hospital_route(resident)
        self.assertFalse(location._route_cache)

    def test_real_sdk_validates_hospital_route_request_and_response(self):
        routes = boto3.client('geo-routes', region_name='us-east-1', config=Config(signature_version=UNSIGNED))
        self.addCleanup(routes.close)
        resident = self.resident.model_copy(update={'nearest_hospital_id': 's-002'})
        with Stubber(routes) as routing, mock.patch.object(location, '_client', return_value=routes):
            routing.add_response('calculate_routes', route_response(), {
                'Origin': [resident.lng, resident.lat],
                'Destination': [self.hospitals[1].lng, self.hospitals[1].lat],
                'TravelMode': 'Car', 'DepartNow': True,
                'Traffic': {'Usage': 'UseTrafficData'}, 'LegGeometryFormat': 'Simple'})
            self.assertEqual(location.hospital_route(resident).drive_minutes, 7.5)
            routing.assert_no_pending_responses()


class LocationApiTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict('os.environ', {'LOCATION_ENABLED': '1', 'HOSPITALS_CSV': ''})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.previous = store._backend
        self.addCleanup(setattr, store, '_backend', self.previous)
        self.resident = Resident(id='r-001', updated_at=datetime.now(timezone.utc),
                                 **seed.ROSTER[0].model_dump())
        store.use_memory([self.resident])
        self.fields = {'drive_minutes': 7.5, 'nearest_hospital_id': 's-002',
                       'location_cache_key': 'test', 'location_updated_at': datetime.now(timezone.utc)}

    def http(self, method, path, body=None):
        async def run():
            messages = []
            async def receive():
                return {'type': 'http.request', 'body': json.dumps(body).encode() if body is not None else b'',
                        'more_body': False}
            async def send(message):
                messages.append(message)
            await main.app({'type': 'http', 'http_version': '1.1', 'method': method,
                            'scheme': 'http', 'path': path, 'raw_path': path.encode(),
                            'query_string': b'', 'root_path': '',
                            'headers': [(b'content-type', b'application/json')],
                            'server': ('test', 80), 'client': ('127.0.0.1', 1234)}, receive, send)
            status = next(m['status'] for m in messages if m['type'] == 'http.response.start')
            payload = b''.join(m.get('body', b'') for m in messages if m['type'] == 'http.response.body')
            return status, json.loads(payload)
        return asyncio.run(run())

    def test_http_hospitals_and_address_only_create(self):
        status, hospitals = self.http('GET', '/hospitals')
        self.assertEqual(status, 200)
        self.assertEqual(len(hospitals), 6)
        body = seed.ROSTER[0].model_dump(exclude={'lat', 'lng'})
        with mock.patch.object(location, 'resolve_position', return_value=seed.ROSTER[0]), \
             mock.patch.object(location, 'drive_times', return_value=[self.fields]):
            status, response = self.http('POST', '/residents', body)
        self.assertEqual(status, 201)
        self.assertEqual(response['nearest_hospital_id'], 's-002')
        self.assertIsInstance(response['location_updated_at'], str)
        self.assertIn('XXX', response['phone'])

    def test_http_hospital_route_serializes_hospital_and_geojson(self):
        result = HospitalRoute(
            resident_id='r-001', hospital=location.load_hospitals()[1],
            drive_minutes=7.5, distance_km=3.5, computed_at=datetime.now(timezone.utc),
            geometry={'type': 'LineString', 'coordinates': [[-121.9, 37.3], [-121.94, 37.32]]})
        with mock.patch.object(location, 'hospital_route', return_value=result) as route:
            status, response = self.http('GET', '/residents/r-001/hospital-route')
        self.assertEqual(status, 200)
        self.assertEqual(response['hospital']['id'], 's-002')
        self.assertEqual(response['geometry']['type'], 'LineString')
        self.assertEqual(response['geometry']['coordinates'][0], [-121.9, 37.3])
        self.assertEqual(response['drive_minutes'], 7.5)
        self.assertIsInstance(response['computed_at'], str)
        self.assertEqual(route.call_args.args[0].id, 'r-001')

    def test_http_hospital_route_reports_missing_disabled_unreachable_and_aws_errors(self):
        with mock.patch.object(location, 'hospital_route') as route:
            self.assertEqual(self.http('GET', '/residents/missing/hospital-route')[0], 404)
            route.assert_not_called()
        with mock.patch.dict('os.environ', {'LOCATION_ENABLED': '0'}):
            self.assertEqual(self.http('GET', '/residents/r-001/hospital-route')[0], 503)
        failure = ClientError({'Error': {'Code': 'AccessDeniedException', 'Message': 'test'}}, 'CalculateRoutes')
        for error, expected in [(location.LocationError('No driving route available'), 422), (failure, 502)]:
            with self.subTest(error=error), mock.patch.object(location, 'hospital_route', side_effect=error):
                status, response = self.http('GET', '/residents/r-001/hospital-route')
                self.assertEqual(status, expected)
                self.assertIn('detail', response)

    def test_http_invalid_coordinate_pair_returns_serializable_validation_error(self):
        status, response = self.http('PATCH', '/residents/r-001', {'lat': None, 'lng': -121})
        self.assertEqual(status, 422)
        self.assertIn('both lat and lng', response['detail'][0]['msg'])

    def test_http_aws_failure_does_not_save_partial_location(self):
        failure = ClientError({'Error': {'Code': 'AccessDeniedException', 'Message': 'test'}}, 'CalculateRouteMatrix')
        with mock.patch.object(location, 'drive_times', side_effect=failure):
            status, response = self.http('POST', '/locations/refresh')
        self.assertEqual(status, 502)
        self.assertIn('Amazon Location request failed', response['detail'])
        self.assertIsNone(store.get_resident('r-001').drive_minutes)

    def test_create_without_coordinates_saves_location_and_masks_phone(self):
        body = ResidentIn.model_validate({**seed.ROSTER[0].model_dump(), 'lat': None, 'lng': None})
        with mock.patch.object(location, 'resolve_position', return_value=seed.ROSTER[0]), \
             mock.patch.object(location, 'drive_times', return_value=[self.fields]):
            response = main.create_resident(body)
        self.assertEqual(response.drive_minutes, 7.5)
        self.assertIn('XXX', response.phone)
        self.assertEqual(store.get_resident(response.id).nearest_hospital_id, 's-002')

    def test_address_patch_geocodes_and_replaces_stale_drive(self):
        resolved = ResidentIn.model_validate({**seed.ROSTER[0].model_dump(), 'address': 'New address',
                                             'lat': 37.5, 'lng': -121.7})
        with mock.patch.object(location, 'resolve_position', return_value=resolved) as geocode, \
             mock.patch.object(location, 'drive_times', return_value=[self.fields]):
            response = main.update_resident('r-001', ResidentPatch(address='New address'))
        self.assertIsNone(geocode.call_args.args[0].lat)
        self.assertEqual((response.lat, response.lng, response.drive_minutes), (37.5, -121.7, 7.5))

    def test_non_location_patch_keeps_cached_fields_without_aws(self):
        store.save_resident(self.resident.model_copy(update=self.fields))
        with mock.patch.object(location, 'drive_times') as routes:
            response = main.update_resident('r-001', ResidentPatch(name='New name'))
        routes.assert_not_called()
        self.assertEqual(response.drive_minutes, 7.5)

    def test_disabled_location_preserves_offline_create_and_invalidates_moved_cache(self):
        with mock.patch.dict('os.environ', {'LOCATION_ENABLED': '0'}):
            self.assertIsNone(main.create_resident(seed.ROSTER[0]).drive_minutes)
            store.save_resident(self.resident.model_copy(update=self.fields))
            moved = main.update_resident('r-001', ResidentPatch(lat=37.5, lng=-121.7))
            self.assertIsNone(moved.drive_minutes)
            with self.assertRaises(HTTPException) as error:
                main.refresh_locations()
            self.assertEqual(error.exception.status_code, 503)

    def test_refresh_reports_unreachable_and_preserves_live_call_changes(self):
        def calculate(residents, force):
            current = store.get_resident('r-001')
            store.save_resident(current.model_copy(update={'status': Status.CALLING, 'contact_id': 'new-call'}))
            return [{**self.fields, 'drive_minutes': None, 'nearest_hospital_id': None, 'location_cache_key': None}]
        with mock.patch.object(location, 'drive_times', side_effect=calculate):
            result = main.refresh_locations(zone='A', force=True)
        self.assertEqual(result['unavailable'], ['r-001'])
        self.assertEqual(store.get_resident('r-001').contact_id, 'new-call')

    def test_stale_location_write_is_refused(self):
        current = store.get_resident('r-001')
        store.save_resident(current.model_copy(update={'lng': -120}))
        self.assertIsNone(store.update_resident('r-001', ResidentPatch(), location_fields=self.fields,
                                               expected_location=(current.address, current.lat, current.lng)))

    def test_invalid_patch_rejected_before_aws(self):
        with mock.patch.object(location, 'drive_times') as routes:
            for patch in [ResidentPatch(lat=37.4), ResidentPatch(name=None)]:
                with self.assertRaises(HTTPException) as error:
                    main.update_resident('r-001', patch)
                self.assertEqual(error.exception.status_code, 422)
            routes.assert_not_called()

    def test_hospitals_available_with_location_disabled(self):
        with mock.patch.dict('os.environ', {'LOCATION_ENABLED': '0'}):
            self.assertEqual(len(main.list_hospitals()), 6)

    def test_cache_persists_through_storage_serialization_and_outage_reset(self):
        cached = self.resident.model_copy(update=self.fields)
        stored = Resident.model_validate(store._from_item(store._to_item(cached.model_dump(mode='json'))))
        store.save_resident(stored)
        store.reset_live_state('A')
        self.assertEqual(store.get_resident('r-001').drive_minutes, 7.5)
        self.assertEqual(store.get_resident('r-001').location_cache_key, 'test')


if __name__ == '__main__':
    unittest.main()
