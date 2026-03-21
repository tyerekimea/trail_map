import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_nigeria_app/main.dart';

void main() {
  setUpAll(() async {
    await dotenv.load(fileName: ".env");
  });

  testWidgets('Polyline creation test', (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: MapScreen()));
    await tester.pumpAndSettle();

    final state = tester.state(find.byType(MapScreen));

    if (state is MapScreenState) {
      state.originController.text = 'Lagos';
      state.destinationController.text = 'Abuja';

      await state.getDirections(useCurrentLocation: false);
      await tester.pumpAndSettle();
    } else {
      fail('Could not find MapScreenState');
    }
  });

  testWidgets('Empty origin and destination shows error',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: MapScreen()));
    await tester.pumpAndSettle();

    final state = tester.state(find.byType(MapScreen));

    if (state is MapScreenState) {
      state.originController.text = '';
      state.destinationController.text = '';

      await state.getDirections(useCurrentLocation: false);
      await tester.pump();

      expect(
        find.text('Please search for a destination first'),
        findsOneWidget,
      );
    } else {
      fail('Could not find MapScreenState');
    }
  });

  test('HTML tags are stripped from instructions', () {
    final testString = '<div>Turn <b>left</b> onto Main St</div>';
    final expected = 'Turn left onto Main St';

    final RegExp exp = RegExp(r'<[^>]*>', multiLine: true, caseSensitive: true);
    final result = testString.replaceAll(exp, '').replaceAll('&nbsp;', ' ');

    expect(result, expected);
  });
}
