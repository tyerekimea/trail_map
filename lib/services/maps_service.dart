import 'api_client.dart';

class MapsService {
  MapsService({ApiClient? client}) : _client = client ?? ApiClient();

  final ApiClient _client;

  Future<Map<String, dynamic>> geocode({
    required String address,
    String country = 'NG',
  }) {
    return _client.getJson(
      '/api/maps/geocode',
      authenticated: true,
      queryParams: {
        'address': address,
        'country': country,
      },
    );
  }

  Future<Map<String, dynamic>> autocomplete({
    required String input,
    String country = 'ng',
    String? types,
  }) {
    final queryParams = <String, String>{
      'input': input,
      'country': country,
    };

    if (types != null && types.isNotEmpty) {
      queryParams['types'] = types;
    }

    return _client.getJson(
      '/api/maps/autocomplete',
      authenticated: true,
      queryParams: queryParams,
    );
  }

  Future<Map<String, dynamic>> directions({
    required String origin,
    required String destination,
    String mode = 'driving',
    String region = 'ng',
  }) {
    return _client.getJson(
      '/api/maps/directions',
      authenticated: true,
      queryParams: {
        'origin': origin,
        'destination': destination,
        'mode': mode,
        'region': region,
      },
    );
  }
}
