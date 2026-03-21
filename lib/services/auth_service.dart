import 'api_client.dart';

class AuthService {
  AuthService({ApiClient? client}) : _client = client ?? ApiClient();

  final ApiClient _client;

  Future<Map<String, dynamic>> register({
    required String email,
    required String password,
    required String name,
    String? phone,
  }) {
    return _client.postJson(
      '/api/auth/register',
      body: {
        'email': email,
        'password': password,
        'name': name,
        if (phone != null && phone.isNotEmpty) 'phone': phone,
      },
    );
  }

  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) {
    return _client.postJson(
      '/api/auth/login',
      body: {
        'email': email,
        'password': password,
      },
    );
  }

  Future<Map<String, dynamic>> refreshToken({
    required String refreshToken,
  }) {
    return _client.postJson(
      '/api/auth/refresh',
      body: {
        'refreshToken': refreshToken,
      },
    );
  }
}
