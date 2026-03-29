import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AuthSession {
  AuthSession._();

  static final AuthSession instance = AuthSession._();
  static const _secureStorage = FlutterSecureStorage();

  static const _accessTokenKey = 'auth_access_token';
  static const _refreshTokenKey = 'auth_refresh_token';
  static const _userEmailKey = 'auth_user_email';
  static const _userNameKey = 'auth_user_name';

  Future<void> _writeToken(String key, String value) async {
    try {
      await _secureStorage.write(key: key, value: value);
      return;
    } on MissingPluginException {
      // Fall back for tests and environments without secure storage plugin.
    } catch (_) {
      // Fall back to SharedPreferences if secure storage fails unexpectedly.
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, value);
  }

  Future<String?> _readToken(String key) async {
    try {
      final value = await _secureStorage.read(key: key);
      if (value != null && value.isNotEmpty) {
        return value;
      }
    } on MissingPluginException {
      // Fall back for tests and environments without secure storage plugin.
    } catch (_) {
      // Fall back to SharedPreferences.
    }

    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(key);
  }

  Future<void> _deleteToken(String key) async {
    try {
      await _secureStorage.delete(key: key);
    } on MissingPluginException {
      // Fall back for tests and environments without secure storage plugin.
    } catch (_) {
      // Fall back to SharedPreferences.
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(key);
  }

  Future<void> saveSession({
    required String accessToken,
    String? refreshToken,
    String? email,
    String? name,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await _writeToken(_accessTokenKey, accessToken);

    if (refreshToken != null && refreshToken.isNotEmpty) {
      await _writeToken(_refreshTokenKey, refreshToken);
    } else {
      await _deleteToken(_refreshTokenKey);
    }

    if (email != null && email.isNotEmpty) {
      await prefs.setString(_userEmailKey, email);
    } else {
      await prefs.remove(_userEmailKey);
    }

    if (name != null && name.isNotEmpty) {
      await prefs.setString(_userNameKey, name);
    } else {
      await prefs.remove(_userNameKey);
    }
  }

  Future<bool> hasSession() async {
    final accessToken = await getAccessToken();
    return accessToken != null && accessToken.isNotEmpty;
  }

  Future<String?> getAccessToken() async {
    return _readToken(_accessTokenKey);
  }

  Future<String?> getRefreshToken() async {
    return _readToken(_refreshTokenKey);
  }

  Future<String?> getUserEmail() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_userEmailKey);
  }

  Future<String?> getUserName() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_userNameKey);
  }

  Future<void> clearSession() async {
    await _deleteToken(_accessTokenKey);
    await _deleteToken(_refreshTokenKey);

    final prefs = await SharedPreferences.getInstance();
    await Future.wait([
      prefs.remove(_userEmailKey),
      prefs.remove(_userNameKey),
    ]);
  }
}
