import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

class LayersWidget extends StatefulWidget {
  final Function(MapType) onMapTypeChanged;

  const LayersWidget({super.key, required this.onMapTypeChanged});

  @override
  // ignore: library_private_types_in_public_api
  _LayersWidgetState createState() => _LayersWidgetState();
}

class _LayersWidgetState extends State<LayersWidget> {
  MapType _currentMapType = MapType.normal;

  @override
  Widget build(BuildContext context) {
    return RadioGroup<MapType>(
      groupValue: _currentMapType,
      onChanged: (value) {
        if (value == null) return;
        setState(() {
          _currentMapType = value;
          widget.onMapTypeChanged(_currentMapType);
        });
      },
      child: const Column(
        children: [
          ListTile(
            title: Text('Normal'),
            leading: Radio<MapType>(value: MapType.normal),
          ),
          ListTile(
            title: Text('Satellite'),
            leading: Radio<MapType>(value: MapType.satellite),
          ),
          ListTile(
            title: Text('Terrain'),
            leading: Radio<MapType>(value: MapType.terrain),
          ),
          ListTile(
            title: Text('Hybrid'),
            leading: Radio<MapType>(value: MapType.hybrid),
          ),
        ],
      ),
    );
  }
}
