import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

class GridWidget extends StatelessWidget {
  final GoogleMapController? mapController;

  const GridWidget({super.key, this.mapController});

  @override
  Widget build(BuildContext context) {
    if (mapController == null) {
      return Container();
    }

    return FutureBuilder<LatLngBounds>(
      future: mapController!.getVisibleRegion(),
      builder: (context, snapshot) {
        if (snapshot.hasData) {
          return CustomPaint(
            painter: GridPainter(snapshot.data!),
          );
        } else {
          return Container();
        }
      },
    );
  }
}

class GridPainter extends CustomPainter {
  final LatLngBounds bounds;

  GridPainter(this.bounds);

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = Colors.black.withValues(alpha: 0.3)
      ..strokeWidth = 1.0;

    // Draw vertical lines
    for (double i = bounds.southwest.longitude;
        i < bounds.northeast.longitude;
        i += 0.1) {
      final double x =
          (i - bounds.southwest.longitude) /
              (bounds.northeast.longitude - bounds.southwest.longitude) *
              size.width;
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }

    // Draw horizontal lines
    for (double i = bounds.southwest.latitude;
        i < bounds.northeast.latitude;
        i += 0.1) {
      final double y =
          (i - bounds.southwest.latitude) /
              (bounds.northeast.latitude - bounds.southwest.latitude) *
              size.height;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) {
    return false;
  }
}
