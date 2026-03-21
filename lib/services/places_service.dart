import 'api_client.dart';
import '../models/saved_place.dart';

class PlacesService {
  PlacesService({ApiClient? client}) : _client = client ?? ApiClient();

  final ApiClient _client;

  Future<Map<String, dynamic>> pullSince({DateTime? since}) {
    final queryParams = <String, String>{};
    if (since != null) {
      queryParams['since'] = since.toUtc().toIso8601String();
    }

    return _client.getJson(
      '/api/places/sync/pull',
      authenticated: true,
      queryParams: queryParams.isEmpty ? null : queryParams,
    );
  }

  Future<Map<String, dynamic>> pushBatch(List<SavedPlace> places) {
    return _client.postJson(
      '/api/places/sync/push',
      authenticated: true,
      body: {
        'places': places.map((place) => place.toSyncPayload()).toList(),
      },
    );
  }

  // Backward-compatible helper for callers still using the old method name.
  Future<Map<String, dynamic>> syncPlaces(List<SavedPlace> places) {
    return pushBatch(places);
  }

  Future<Map<String, dynamic>> getPlaces() {
    return _client.getJson('/api/places', authenticated: true);
  }

  Future<Map<String, dynamic>> createPlace(SavedPlace place) {
    return _client.postJson(
      '/api/places',
      authenticated: true,
      body: {
        'clientId': place.clientId,
        'name': place.name,
        'address': place.address,
        'latitude': place.latitude,
        'longitude': place.longitude,
        'category': place.category,
      },
    );
  }

  Future<Map<String, dynamic>> updatePlace({
    required String placeId,
    required SavedPlace place,
  }) {
    return _client.putJson(
      '/api/places/$placeId',
      authenticated: true,
      body: {
        'clientId': place.clientId,
        'name': place.name,
        'address': place.address,
        'latitude': place.latitude,
        'longitude': place.longitude,
        'category': place.category,
        'updatedAt': place.updatedAt.toIso8601String(),
        'isDeleted': place.isDeleted,
      },
    );
  }

  Future<Map<String, dynamic>> deletePlace(String placeId) {
    return _client.deleteJson(
      '/api/places/$placeId',
      authenticated: true,
    );
  }
}
