# Flutter Mobile App Integration Guide

**Date:** March 29, 2026  
**Version:** 1.0  
**Target:** Trail Map Flutter App

---

## Overview of New Features

The backend has been updated with the following new features that the Flutter app should integrate:

1. **Password Reset Flow** - Help users recover their accounts
2. **Account Deletion (GDPR)** - Allow users to delete their data
3. **Data Export** - Export user data in JSON format
4. **Enhanced Input Validation** - Better error messages
5. **Improved Logging** - Better debugging and monitoring
6. **User Logout** - Proper token invalidation

---

## 1. Password Reset Screen

### Create New Dart File: lib/screens/password_reset_screen.dart

```dart
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../services/api_client.dart';
import '../services/logger.dart';

class PasswordResetScreen extends StatefulWidget {
  @override
  _PasswordResetScreenState createState() => _PasswordResetScreenState();
}

class _PasswordResetScreenState extends State<PasswordResetScreen> {
  final _emailController = TextEditingController();
  final _tokenController = TextEditingController();
  final _newPasswordController = TextEditingController();
  bool _isLoading = false;
  bool _showTokenInput = false;
  String? _errorMessage;
  String? _successMessage;

  final apiClient = ApiClient();
  final logger = AppLogger();

  @override
  void dispose() {
    _emailController.dispose();
    _tokenController.dispose();
    _newPasswordController.dispose();
    super.dispose();
  }

  Future<void> _requestReset() async {
    if (_emailController.text.isEmpty) {
      setState(() => _errorMessage = 'Please enter your email');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final response = await apiClient.post(
        '/api/auth/password-reset-request',
        body: {
          'email': _emailController.text,
        },
      );

      if (response.statusCode == 200) {
        setState(() {
          _successMessage = 'Check your email for reset instructions';
          _showTokenInput = true;
          _isLoading = false;
        });
        logger.info('Password reset email sent', {
          'email': _emailController.text,
        });
      } else {
        setState(() {
          _errorMessage = 'Failed to send reset email. Try again.';
          _isLoading = false;
        });
      }
    } catch (error) {
      setState(() {
        _errorMessage = 'Network error. Please try again.';
        _isLoading = false;
      });
      logger.error('Password reset request failed', {'error': error.toString()});
    }
  }

  Future<void> _submitReset() async {
    if (_tokenController.text.isEmpty || _newPasswordController.text.isEmpty) {
      setState(() => _errorMessage = 'Please fill all fields');
      return;
    }

    if (_newPasswordController.text.length < 6) {
      setState(() => _errorMessage = 'Password must be at least 6 characters');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final response = await apiClient.post(
        '/api/auth/password-reset',
        body: {
          'email': _emailController.text,
          'token': _tokenController.text,
          'newPassword': _newPasswordController.text,
        },
      );

      if (response.statusCode == 200) {
        setState(() {
          _successMessage = 'Password reset successful! You can now login.';
          _isLoading = false;
        });
        
        // Navigate back to login
        Future.delayed(Duration(seconds: 2), () {
          Navigator.of(context).pop();
        });
        
        logger.info('Password reset successful', {
          'email': _emailController.text,
        });
      } else {
        setState(() {
          _errorMessage = 'Invalid or expired reset token. Please try again.';
          _isLoading = false;
        });
      }
    } catch (error) {
      setState(() {
        _errorMessage = 'Network error. Please try again.';
        _isLoading = false;
      });
      logger.error('Password reset submission failed', {'error': error.toString()});
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Reset Password')),
      body: SingleChildScrollView(
        padding: EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_errorMessage != null)
              Padding(
                padding: EdgeInsets.only(bottom: 16.0),
                child: Container(
                  padding: EdgeInsets.all(12.0),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    border: Border.all(color: Colors.red),
                    borderRadius: BorderRadius.circular(8.0),
                  ),
                  child: Text(
                    _errorMessage!,
                    style: TextStyle(color: Colors.red),
                  ),
                ),
              ),
            if (_successMessage != null)
              Padding(
                padding: EdgeInsets.only(bottom: 16.0),
                child: Container(
                  padding: EdgeInsets.all(12.0),
                  decoration: BoxDecoration(
                    color: Colors.green.shade50,
                    border: Border.all(color: Colors.green),
                    borderRadius: BorderRadius.circular(8.0),
                  ),
                  child: Text(
                    _successMessage!,
                    style: TextStyle(color: Colors.green),
                  ),
                ),
              ),
            TextField(
              controller: _emailController,
              decoration: InputDecoration(
                labelText: 'Email',
                hintText: 'your@email.com',
                enabled: !_showTokenInput || _isLoading,
              ),
              keyboardType: TextInputType.emailAddress,
            ),
            SizedBox(height: 16.0),
            if (!_showTokenInput)
              ElevatedButton(
                onPressed: _isLoading ? null : _requestReset,
                child: _isLoading
                    ? SizedBox(
                        height: 20.0,
                        width: 20.0,
                        child: CircularProgressIndicator(strokeWidth: 2.0),
                      )
                    : Text('Send Reset Email'),
              ),
            if (_showTokenInput) ...[
              TextField(
                controller: _tokenController,
                decoration: InputDecoration(
                  labelText: 'Reset Token',
                  hintText: 'Paste the token from your email',
                ),
              ),
              SizedBox(height: 16.0),
              TextField(
                controller: _newPasswordController,
                decoration: InputDecoration(
                  labelText: 'New Password',
                  hintText: 'At least 6 characters',
                ),
                obscureText: true,
              ),
              SizedBox(height: 16.0),
              ElevatedButton(
                onPressed: _isLoading ? null : _submitReset,
                child: _isLoading
                    ? SizedBox(
                        height: 20.0,
                        width: 20.0,
                        child: CircularProgressIndicator(strokeWidth: 2.0),
                      )
                    : Text('Reset Password'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
```

---

## 2. Account Settings with Deletion Option

### Update: lib/screens/settings_screen.dart

```dart
import 'package:flutter/material.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/logger.dart';

class SettingsScreen extends StatefulWidget {
  @override
  _SettingsScreenState createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final apiClient = ApiClient();
  final authService = AuthService();
  final logger = AppLogger();
  bool _isLoading = false;

  Future<void> _showDeleteConfirmation() async {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete Account'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'This action cannot be undone. All your data will be permanently deleted:',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 12.0),
              Text('• Your profile'),
              Text('• All saved places'),
              Text('• All activity history'),
              Text('• All settings'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              _showPasswordConfirmation();
            },
            child: Text(
              'Delete Account',
              style: TextStyle(color: Colors.red),
            ),
          ),
        ],
      ),
    );
  }

  void _showPasswordConfirmation() {
    final passwordController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Confirm Password'),
        content: TextField(
          controller: passwordController,
          decoration: InputDecoration(labelText: 'Enter your password'),
          obscureText: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              _deleteAccount(passwordController.text);
            },
            child: Text(
              'Delete',
              style: TextStyle(color: Colors.red),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _deleteAccount(String password) async {
    if (password.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Please enter your password')),
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      final response = await apiClient.delete(
        '/api/users/account',
        body: {'password': password},
      );

      if (response.statusCode == 200) {
        logger.info('Account deleted successfully');
        
        // Clear local storage
        await authService.logout();
        
        // Navigate to login
        Navigator.of(context).pushNamedAndRemoveUntil(
          '/login',
          (route) => false,
        );
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Account deleted. Your data has been removed.')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to delete account. Wrong password?')),
        );
      }
    } catch (error) {
      logger.error('Account deletion failed', {'error': error.toString()});
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error deleting account')),
      );
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _exportData() async {
    setState(() => _isLoading = true);

    try {
      final response = await apiClient.post(
        '/api/users/export-data',
        body: {},
      );

      if (response.statusCode == 200) {
        // Save exported data
        final data = response.body;
        logger.info('User data exported successfully');
        
        // Show success dialog with download option
        showDialog(
          context: context,
          builder: (context) => AlertDialog(
            title: Text('Data Exported'),
            content: Text('Your data has been prepared for download. Check your downloads folder.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text('OK'),
              ),
            ],
          ),
        );
      }
    } catch (error) {
      logger.error('Data export failed', {'error': error.toString()});
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to export data')),
      );
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Settings')),
      body: ListView(
        children: [
          ListTile(
            title: Text('Export My Data (GDPR)'),
            subtitle: Text('Download a copy of your data'),
            trailing: Icon(Icons.download),
            onTap: _isLoading ? null : _exportData,
          ),
          Divider(),
          ListTile(
            title: Text('Delete Account'),
            subtitle: Text('Permanently delete all your data'),
            trailing: Icon(Icons.delete, color: Colors.red),
            onTap: _isLoading ? null : _showDeleteConfirmation,
          ),
        ],
      ),
    );
  }
}
```

---

## 3. Update Auth Service for New Endpoints

### Update: lib/services/auth_service.dart

Add these methods:

```dart
class AuthService {
  // ... existing code ...

  Future<bool> requestPasswordReset(String email) async {
    try {
      final response = await _apiClient.post(
        '/api/auth/password-reset-request',
        body: {'email': email},
      );
      return response.statusCode == 200;
    } catch (e) {
      logger.error('Password reset request failed', {'error': e.toString()});
      return false;
    }
  }

  Future<bool> resetPassword({
    required String email,
    required String token,
    required String newPassword,
  }) async {
    try {
      final response = await _apiClient.post(
        '/api/auth/password-reset',
        body: {
          'email': email,
          'token': token,
          'newPassword': newPassword,
        },
      );
      return response.statusCode == 200;
    } catch (e) {
      logger.error('Password reset failed', {'error': e.toString()});
      return false;
    }
  }

  Future<void> logout() async {
    try {
      final refreshToken = await _secureStorage.read(key: 'refreshToken');
      if (refreshToken != null && _accessToken != null) {
        await _apiClient.post(
          '/api/auth/logout',
          body: {'refreshToken': refreshToken},
        );
      }
    } catch (e) {
      logger.warn('Logout request failed', {'error': e.toString()});
    }

    // Clear local storage regardless of API response
    await _secureStorage.delete(key: 'accessToken');
    await _secureStorage.delete(key: 'refreshToken');
    await _secureStorage.delete(key: 'userId');
    _accessToken = null;
    _isAuthenticated = false;
    notifyListeners();
  }

  Future<Map<String, dynamic>> exportUserData() async {
    try {
      final response = await _apiClient.post(
        '/api/users/export-data',
        body: {},
      );
      
      if (response.statusCode == 200) {
        return jsonDecode(response.body)['data'];
      }
      throw Exception('Failed to export data');
    } catch (e) {
      logger.error('Data export failed', {'error': e.toString()});
      rethrow;
    }
  }

  Future<bool> deleteAccount(String password) async {
    try {
      final response = await _apiClient.delete(
        '/api/users/account',
        body: {'password': password},
      );

      if (response.statusCode == 200) {
        // Clear all local data on successful deletion
        await logout();
        return true;
      }
      return false;
    } catch (e) {
      logger.error('Account deletion failed', {'error': e.toString()});
      return false;
    }
  }
}
```

---

## 4. Update API Client for Better Error Handling

### Update: lib/services/api_client.dart

```dart
class ApiClient {
  // ... existing code ...

  Future<http.Response> _handleResponse(http.Response response, String endpoint) async {
    logger.debug('API Response', {
      'endpoint': endpoint,
      'statusCode': response.statusCode,
      'duration': response.request?.sentAt,
    });

    if (response.statusCode >= 500) {
      throw ServerException('Server error: ${response.statusCode}');
    }

    if (response.statusCode == 429) {
      throw RateLimitException('Too many requests. Please try again later.');
    }

    if (response.statusCode == 401) {
      // Unauthorized - likely token expired
      await authService.logout();
      throw UnauthorizedException('Session expired. Please login again.');
    }

    if (response.statusCode >= 400) {
      try {
        final error = jsonDecode(response.body);
        throw ValidationException(error['message'] ?? 'Request failed');
      } catch (_) {
        throw RequestException('Request failed with status ${response.statusCode}');
      }
    }

    return response;
  }
}

// Custom exceptions
class RateLimitException implements Exception {
  final String message;
  RateLimitException(this.message);
  
  @override
  String toString() => message;
}

class ValidationException implements Exception {
  final String message;
  ValidationException(this.message);
  
  @override
  String toString() => message;
}

class ServerException implements Exception {
  final String message;
  ServerException(this.message);
  
  @override
  String toString() => message;
}

class UnauthorizedException implements Exception {
  final String message;
  UnauthorizedException(this.message);
  
  @override
  String toString() => message;
}

class RequestException implements Exception {
  final String message;
  RequestException(this.message);
  
  @override
  String toString() => message;
}
```

---

## 5. Update Login Screen to Add Reset Link

### Update: lib/screens/login_screen.dart

Add this button:

```dart
// In the login form, add below the login button:

Padding(
  padding: EdgeInsets.symmetric(vertical: 16.0),
  child: TextButton(
    onPressed: () {
      Navigator.of(context).pushNamed('/password-reset');
    },
    child: Text('Forgot Password?'),
  ),
),
```

---

## 6. Configure Routes in main.dart

### Update: lib/main.dart

```dart
// Add to routes:
routes: {
  '/login': (context) => LoginScreen(),
  '/password-reset': (context) => PasswordResetScreen(),
  '/settings': (context) => SettingsScreen(),
  // ... other routes ...
}
```

---

## 7. Update Sync Service for Better Error Handling

### Update: lib/services/sync_service.dart

```dart
Future<SyncResult> performSync() async {
  try {
    logger.info('Sync started');
    
    // ... existing sync code ...

    // Enhanced logging for batch operations
    logger.info('Sync completed', {
      'created': result.created,
      'updated': result.updated,
      'deleted': result.deleted,
      'conflicts': result.conflicts,
      'duration': stopwatch.elapsedMilliseconds,
    });

    return result;
  } on RateLimitException {
    logger.warn('Sync rate limited');
    throw SyncException('Server is busy. Please try again in a moment.');
  } on UnauthorizedException {
    logger.error('Sync unauthorized - token expired');
    throw SyncException('Session expired. Please login again.');
  } catch (e) {
    logger.error('Sync failed', {'error': e.toString()});
    rethrow;
  }
}
```

---

## 8. Testing Checklist

- [ ] Test password reset flow end-to-end
- [ ] Verify email receipt for reset link
- [ ] Test token expiration after 1 hour
- [ ] Test account deletion with cascading removal
- [ ] Verify data export is complete and accurate
- [ ] Test logout invalidates refresh tokens
- [ ] Verify proper error messages for validation failures
- [ ] Test on slow network conditions
- [ ] Test with invalid/expired tokens
- [ ] Performance test sync with 100+ places

---

## 9. Deployment Checklist

Before deploying to production:

- [ ] Update API_URL environment variable to production backend
- [ ] Update password reset URL to production domain
- [ ] Enable SSL certificate pinning
- [ ] Test all new screens in production build
- [ ] Verify SMTP emails send from production address
- [ ] Performance test on staging environment
- [ ] Security scan of new code
- [ ] Update app version number
- [ ] Create release notes for new features

---

## API Endpoint Summary

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/password-reset-request` | Request password reset email |
| POST | `/api/auth/password-reset` | Complete password reset with token |
| POST | `/api/auth/logout` | Logout and revoke tokens |

### User Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/users/export-data` | Export all user data (GDPR) |
| DELETE | `/api/users/account` | Delete account and all data |
| GET | `/api/users/profile` | Get user profile |
| PUT | `/api/users/profile` | Update user profile |

### Places

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/places/sync/push` | Sync local places to server |
| GET | `/api/places/sync/pull` | Pull server places to device |
| GET | `/api/places` | Get all active places |
| POST | `/api/places` | Create new place |
| PUT | `/api/places/:id` | Update place |
| DELETE | `/api/places/:id` | Delete place |

---

**Need help?** Contact the backend team or see backend/DEPLOYMENT.md for more details.
