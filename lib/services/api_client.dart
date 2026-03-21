import 'dart:async';
import 'dart:convert';

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

  String get _baseUrl {
    final baseUrl = dotenv.env['BACKEND_BASE_URL']?.trim() ?? '';
    if (baseUrl.isEmpty) {
      throw ApiException(
        'BACKEND_BASE_URL is not configured in .env',
      );
    }
    return baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
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
    final headers = await _buildHeaders(authenticated: authenticated);
    return _send(
      () => _httpClient.get(
        _buildUri(path, queryParams: queryParams),
        headers: headers,
      ),
    );
  }

  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, String>? queryParams,
    Object? body,
    bool authenticated = false,
  }) async {
    final headers = await _buildHeaders(authenticated: authenticated);
    return _send(
      () => _httpClient.post(
        _buildUri(path, queryParams: queryParams),
        headers: headers,
        body: body == null ? null : json.encode(body),
      ),
    );
  }

  Future<Map<String, dynamic>> putJson(
    String path, {
    Map<String, String>? queryParams,
    Object? body,
    bool authenticated = false,
  }) async {
    final headers = await _buildHeaders(authenticated: authenticated);
    return _send(
      () => _httpClient.put(
        _buildUri(path, queryParams: queryParams),
        headers: headers,
        body: body == null ? null : json.encode(body),
      ),
    );
  }

  Future<Map<String, dynamic>> deleteJson(
    String path, {
    Map<String, String>? queryParams,
    bool authenticated = false,
  }) async {
    final headers = await _buildHeaders(authenticated: authenticated);
    return _send(
      () => _httpClient.delete(
        _buildUri(path, queryParams: queryParams),
        headers: headers,
      ),
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
    Future<http.Response> Function() request,
  ) async {
    late http.Response response;
    try {
      response = await request().timeout(_timeout);
    } on TimeoutException {
      throw ApiException('Request timed out');
    } catch (_) {
      throw ApiException('Unable to reach backend server');
    }

    final payload = _decodeBody(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return payload;
    }

    final message = _extractMessage(payload);
    throw ApiException(message, statusCode: response.statusCode);
  }

  Map<String, dynamic> _decodeBody(String body) {
    if (body.trim().isEmpty) return {};

    final decoded = json.decode(body);
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
