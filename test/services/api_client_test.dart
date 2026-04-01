import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:google_maps_nigeria_app/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ApiClient', () {
    test('throws when BACKEND_BASE_URL is missing', () async {
      dotenv.testLoad(fileInput: '');
      final client = ApiClient(
        httpClient: MockClient((_) async => http.Response('{}', 200)),
      );

      await expectLater(
        client.getJson('/api/health'),
        throwsA(isA<ApiException>()),
      );
    });

    test('attaches bearer token for authenticated requests', () async {
      dotenv.testLoad(fileInput: 'BACKEND_BASE_URL=http://localhost:3000');
      late http.Request capturedRequest;
      final client = ApiClient(
        tokenProvider: () async => 'access-token',
        httpClient: MockClient((request) async {
          capturedRequest = request;
          return http.Response(json.encode({'success': true}), 200);
        }),
      );

      final result = await client.getJson('/api/places', authenticated: true);

      expect(result['success'], true);
      expect(capturedRequest.headers['Authorization'], 'Bearer access-token');
    });

    test('refreshes token on 401 and retries once', () async {
      dotenv.testLoad(fileInput: 'BACKEND_BASE_URL=http://localhost:3000');
      SharedPreferences.setMockInitialValues({
        'auth_access_token': 'expired-access',
        'auth_refresh_token': 'refresh-1',
        'auth_user_email': 'user@example.com',
        'auth_user_name': 'User'
      });

      var secureEndpointHits = 0;
      final client = ApiClient(
        httpClient: MockClient((request) async {
          if (request.url.path == '/api/auth/refresh') {
            final body =
                json.decode(request.body) as Map<String, dynamic>;
            expect(body['refreshToken'], 'refresh-1');
            return http.Response(
              json.encode({
                'data': {
                  'token': 'fresh-access',
                  'refreshToken': 'refresh-2'
                }
              }),
              200,
            );
          }

          if (request.url.path == '/api/secure') {
            if (secureEndpointHits == 0) {
              secureEndpointHits += 1;
              return http.Response(
                json.encode({'message': 'expired'}),
                401,
              );
            }
            expect(request.headers['Authorization'], 'Bearer fresh-access');
            return http.Response(
              json.encode({'success': true}),
              200,
            );
          }

          return http.Response('{}', 404);
        }),
      );

      final result = await client.getJson('/api/secure', authenticated: true);
      final prefs = await SharedPreferences.getInstance();

      expect(result['success'], true);
      expect(prefs.getString('auth_refresh_token'), 'refresh-2');
    });
  });
}
