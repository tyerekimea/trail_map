import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:google_maps_nigeria_app/screens/auth_screen.dart';

void main() {
  testWidgets('Auth screen shows login form by default', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: AuthScreen(
          onAuthenticated: () async {},
        ),
      ),
    );

    expect(find.text('Sign in to continue'), findsOneWidget);
    expect(find.text('Need an account? Register'), findsOneWidget);
    expect(find.text('Login'), findsWidgets);
  });
}
