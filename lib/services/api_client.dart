import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:http/http.dart' as http;

import 'auth_session.dart';

class ApiException implements Exception {
  final String message;
  final int? statusCode;

  ApiException(this.message, {this.statusCode});

  @override
  String toString() => message;
}

typedef TokenProvider = Future<String?> Function();

class ApiClient {
  ApiClient({
    http.Client? httpClient,
    TokenProvider? tokenProvider,
    Duration? timeout,
  })  : _httpClient = httpClient ?? http.Client(),
        tokenProvider = tokenProvider ?? AuthSession.instance.getAccessToken,
        _timeout = timeout ?? const Duration(seconds: 15);

  final http.Client _httpClient;
  final Duration _timeout;
  final TokenProvider tokenProvider;
  Future<bool>? _refreshInFlight;

  String get _baseUrl {
    final baseUrl = dotenv.env['BACKEND_BASE_URL']?.trim() ?? '';
    if (baseUrl.isEmpty) {
      throw ApiException(
        'BACKEND_BASE_URL is not configured in .env',
      );
    }
    final normalized = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    final parsed = Uri.tryParse(normalized);
    if (parsed == null || !parsed.hasScheme || !parsed.hasAuthority) {
      throw ApiException('BACKEND_BASE_URL is invalid');
    }
    if (kReleaseMode && parsed.scheme.toLowerCase() != 'https') {
      throw ApiException(
        'BACKEND_BASE_URL must use HTTPS in release builds',
      );
    }
    return normalized;
  }

  Uri _buildUri(String path, {Map<String, String>? queryParams}) {
    final normalizedPath = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$_baseUrl$normalizedPath').replace(
      queryParameters: queryParams,
    );
  }

  Future<Map<String, dynamic>> getJson(
    String path, {
    Map<String, String>? queryParams,
    bool authenticated = false,
  }) async {
    return _send(
      (headers) => _httpClient.get(
        _buildUri(path, queryParams: queryParams),
        headers: headers,
      ),
      authenticated: authenticated,
    );
  }

  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, String>? queryParams,
    Object? body,
    bool authenticated = false,
  }) async {
    return _send(
      (headers) => _httpClient.post(
        _buildUri(path, queryParams: queryParams),
        headers: headers,
        body: body == null ? null : json.encode(body),
      ),
      authenticated: authenticated,
    );
  }

  Future<Map<String, dynamic>> putJson(
    String path, {
    Map<String, String>? queryParams,
    Object? body,
    bool authenticated = false,
  }) async {
    return _send(
      (headers) => _httpClient.put(
        _buildUri(path, queryParams: queryParams),
        headers: headers,
        body: body == null ? null : json.encode(body),
      ),
      authenticated: authenticated,
    );
  }

  Future<Map<String, dynamic>> deleteJson(
    String path, {
    Map<String, String>? queryParams,
    bool authenticated = false,
  }) async {
    return _send(
      (headers) => _httpClient.delete(
        _buildUri(path, queryParams: queryParams),
        headers: headers,
      ),
      authenticated: authenticated,
    );
  }

  Future<Map<String, String>> _buildHeaders({
    required bool authenticated,
  }) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (authenticated) {
      final token = await tokenProvider.call();
      if (token != null && token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }
    }

    return headers;
  }

  Future<Map<String, dynamic>> _send(
    Future<http.Response> Function(Map<String, String> headers) request, {
    required bool authenticated,
  }) async {
    var headers = await _buildHeaders(authenticated: authenticated);
    var response = await _performRequest(() => request(headers));

    if (response.statusCode == 401 && authenticated) {
      final refreshed = await _refreshAccessToken();
      if (refreshed) {
        headers = await _buildHeaders(authenticated: authenticated);
        response = await _performRequest(() => request(headers));
      }
    }

    final payload = _decodeBody(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return payload;
    }

    final message = _extractMessage(payload);
    throw ApiException(message, statusCode: response.statusCode);
  }

  Future<http.Response> _performRequest(
    Future<http.Response> Function() request,
  ) async {
    try {
      return await request().timeout(_timeout);
    } on TimeoutException {
      throw ApiException('Request timed out');
    } catch (_) {
      throw ApiException('Unable to reach backend server');
    }
  }

  Future<bool> _refreshAccessToken() async {
    if (_refreshInFlight != null) {
      return _refreshInFlight!;
    }

    final future = _attemptTokenRefresh();
    _refreshInFlight = future;
    try {
      return await future;
    } finally {
      _refreshInFlight = null;
    }
  }

  Future<bool> _attemptTokenRefresh() async {
    final refreshToken = await AuthSession.instance.getRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      return false;
    }

    late http.Response refreshResponse;
    try {
      refreshResponse = await _httpClient
          .post(
            _buildUri('/api/auth/refresh'),
            headers: const {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: json.encode({'refreshToken': refreshToken}),
          )
          .timeout(_timeout);
    } catch (_) {
      return false;
    }

    if (refreshResponse.statusCode < 200 || refreshResponse.statusCode >= 300) {
      if (refreshResponse.statusCode == 401 ||
          refreshResponse.statusCode == 403) {
        await AuthSession.instance.clearSession();
      }
      return false;
    }

    final payload = _decodeBody(refreshResponse.body);
    final data = payload['data'];
    final dataMap = data is Map<String, dynamic> ? data : <String, dynamic>{};
    final newAccessToken = (dataMap['token'] ?? payload['token'])?.toString();
    if (newAccessToken == null || newAccessToken.isEmpty) {
      return false;
    }

    final rotatedRefreshToken =
        (dataMap['refreshToken'] ?? payload['refreshToken'])?.toString();
    final email = await AuthSession.instance.getUserEmail();
    final name = await AuthSession.instance.getUserName();
    await AuthSession.instance.saveSession(
      accessToken: newAccessToken,
      refreshToken:
          (rotatedRefreshToken != null && rotatedRefreshToken.isNotEmpty)
              ? rotatedRefreshToken
              : refreshToken,
      email: email,
      name: name,
    );

    return true;
  }

  Map<String, dynamic> _decodeBody(String body) {
    if (body.trim().isEmpty) return {};

    dynamic decoded;
    try {
      decoded = json.decode(body);
    } catch (_) {
      return {'message': body};
    }
    if (decoded is Map<String, dynamic>) return decoded;
    if (decoded is List) return {'data': decoded};
    return {'value': decoded};
  }

  String _extractMessage(Map<String, dynamic> payload) {
    final candidates = [
      payload['error_message'],
      payload['message'],
      payload['error'],
      payload['status'],
    ];

    for (final candidate in candidates) {
      if (candidate is String && candidate.trim().isNotEmpty) {
        return candidate;
      }
    }

    return 'Request failed';
  }
}
