import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_nigeria_app/models/saved_place.dart';

void main() {
  test('SavedPlace.newLocal creates dirty non-deleted record', () {
    final place = SavedPlace.newLocal(
      name: 'Home',
      address: 'Abuja',
      latitude: 9.05785,
      longitude: 7.49508,
      category: 'Home',
    );

    expect(place.clientId, startsWith('cp_'));
    expect(place.isDirty, isTrue);
    expect(place.isDeleted, isFalse);
  });

  test('Deleted sync payload includes deletedAt', () {
    final place = SavedPlace.newLocal(
      name: 'Old place',
      address: 'Lagos',
      latitude: 6.45,
      longitude: 3.39,
      category: 'Other',
    ).copyWith(
      isDeleted: true,
      updatedAt: DateTime.utc(2026, 1, 2, 10, 0, 0),
    );

    final payload = place.toSyncPayload();
    expect(payload['isDeleted'], isTrue);
    expect(payload['deletedAt'], equals('2026-01-02T10:00:00.000Z'));
  });

  test('fromServerMap marks record deleted when deletedAt is present', () {
    final place = SavedPlace.fromServerMap({
      'serverId': 'srv_1',
      'clientId': 'cp_1',
      'name': 'Archived',
      'address': 'Port Harcourt',
      'latitude': 4.8156,
      'longitude': 7.0498,
      'category': 'Other',
      'createdAt': '2026-01-01T00:00:00.000Z',
      'updatedAt': '2026-01-02T00:00:00.000Z',
      'deletedAt': '2026-01-03T00:00:00.000Z',
    });

    expect(place.serverId, 'srv_1');
    expect(place.isDeleted, isTrue);
    expect(place.isDirty, isFalse);
  });
}
