import 'dart:convert';
import 'dart:async';
import 'dart:ui' as ui;
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:http/http.dart' as http;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:math' show cos, sqrt, asin;
import 'models/saved_place.dart';
import 'services/database_helper.dart';
import 'screens/saved_places_screen.dart';
import 'screens/offline_maps_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: ".env");
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Google Maps Nigeria App',
      home: MapScreen(key: MapScreen.mapKey),
    );
  }
}

List<LatLng> _decodePolyline(String polyline) {
  List<LatLng> points = [];
  int index = 0, len = polyline.length;
  int lat = 0, lng = 0;

  while (index < len) {
    int b, shift = 0, result = 0;
    do {
      b = polyline.codeUnitAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    int dlat = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = polyline.codeUnitAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    int dlng = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.add(LatLng(lat / 1E5, lng / 1E5));
  }
  return points;
}

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  static final GlobalKey<MapScreenState> mapKey = GlobalKey();

  @override
  MapScreenState createState() => MapScreenState();
}

class MapScreenState extends State<MapScreen> {
  GoogleMapController? mapController;
  bool _isMapLoading = true;
  String? _errorMessage;
  MapType _currentMapType = MapType.normal;
  final Set<Marker> _markers = {};
  final Set<Polyline> _polylines = {};
  final TextEditingController searchController = TextEditingController();
  final TextEditingController originController = TextEditingController();
  final TextEditingController destinationController = TextEditingController();
  List<String> _suggestions = [];
  String _travelMode = 'driving';
  String? _eta;
  String? _distance;
  List<String> _instructions = [];
  BitmapDescriptor? _carIcon;

  // Navigation state
  bool _isNavigating = false;
  StreamSubscription<Position>? _positionStream;
  FlutterTts? _flutterTts;
  List<Map<String, dynamic>> _navigationSteps = [];
  int _currentStepIndex = 0;
  LatLng? _currentPosition;
  LatLng? _destination;

  // Traffic and offline maps
  bool _showTraffic = false;
  List<SavedPlace> _savedPlaces = [];
  SharedPreferences? _prefs;

  @override
  void initState() {
    super.initState();
    _createCarIcon();
    _initTts();
    _initPreferences();
    _loadSavedPlaces();
    debugPrint(
        'API Key loaded: ${dotenv.env['GOOGLE_MAPS_API_KEY'] != null ? 'Yes' : 'No'}');
    if (dotenv.env['GOOGLE_MAPS_API_KEY'] == null ||
        dotenv.env['GOOGLE_MAPS_API_KEY']!.isEmpty) {
      setState(() {
        _isMapLoading = false;
        _errorMessage =
            'Google Maps API key is missing. Please add it to your .env file.';
      });
      return;
    }
    _getCurrentLocation();
    Future.delayed(const Duration(seconds: 10), () {
      if (_isMapLoading && mounted) {
        setState(() {
          _isMapLoading = false;
          _errorMessage =
              'Failed to load map. Please check your internet connection and API key.';
        });
      }
    });
  }

  Future<void> _initPreferences() async {
    _prefs = await SharedPreferences.getInstance();
    setState(() {
      _showTraffic = _prefs?.getBool('showTraffic') ?? false;
    });
  }

  Future<void> _loadSavedPlaces() async {
    try {
      final places = await DatabaseHelper.instance.readAll();
      if (mounted) {
        setState(() {
          _savedPlaces = places;
        });
      }
    } catch (e) {
      debugPrint('Error loading saved places: $e');
    }
  }

  @override
  void dispose() {
    _positionStream?.cancel();
    _flutterTts?.stop();
    super.dispose();
  }

  Future<void> _initTts() async {
    try {
      _flutterTts = FlutterTts();
      await _flutterTts?.setLanguage("en-US");
      await _flutterTts?.setSpeechRate(0.5);
      await _flutterTts?.setVolume(1.0);
      await _flutterTts?.setPitch(1.0);
    } catch (e) {
      debugPrint('TTS initialization error: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Voice guidance unavailable: $e')),
        );
      }
    }
  }

  Future<void> _createCarIcon() async {
    final pictureRecorder = ui.PictureRecorder();
    final canvas = Canvas(pictureRecorder);
    final paint = Paint()..color = Colors.blue;

    const size = 60.0;
    canvas.drawCircle(const Offset(size / 2, size / 2), size / 2, paint);

    final iconPainter = TextPainter(textDirection: TextDirection.ltr);
    iconPainter.text = const TextSpan(
      text: '🚗',
      style: TextStyle(fontSize: 30.0),
    );
    iconPainter.layout();
    iconPainter.paint(canvas, const Offset(15, 15));

    final picture = pictureRecorder.endRecording();
    final image = await picture.toImage(size.toInt(), size.toInt());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);

    if (mounted) {
      setState(() {
        _carIcon = BitmapDescriptor.fromBytes(bytes!.buffer.asUint8List());
      });
    }

    // Clean up image resource
    image.dispose();
  }

  void onMapCreated(GoogleMapController controller) {
    setState(() {
      mapController = controller;
      _errorMessage = null;
      _isMapLoading = false;
    });
  }

  Future<void> _getCurrentLocation({bool showMessage = false}) async {
    if (showMessage && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Getting your location...')),
      );
    }

    try {
      bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                  'Location services are disabled. Please enable location in your browser.'),
              duration: Duration(seconds: 5),
            ),
          );
        }
        if (mounted) {
          setState(() {
            _isMapLoading = false;
          });
        }
        return;
      }

      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                    'Location permission denied. Please allow location access.'),
                duration: Duration(seconds: 5),
              ),
            );
          }
          if (mounted) {
            setState(() {
              _isMapLoading = false;
            });
          }
          return;
        }
      }

      if (permission == LocationPermission.deniedForever) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                  'Location permission permanently denied. Please enable in browser settings.'),
              duration: Duration(seconds: 5),
            ),
          );
        }
        if (mounted) {
          setState(() {
            _isMapLoading = false;
          });
        }
        return;
      }

      debugPrint('Getting current position...');
      Position position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 10),
      );

      debugPrint(
          'Position obtained: ${position.latitude}, ${position.longitude}');
      LatLng currentLocation = LatLng(position.latitude, position.longitude);

      if (mounted) {
        setState(() {
          _currentPosition = currentLocation;
          _markers.removeWhere((m) => m.markerId.value == 'currentLocation');
          _markers.add(
            Marker(
              markerId: const MarkerId('currentLocation'),
              position: currentLocation,
              infoWindow: const InfoWindow(
                title: 'Your Location',
              ),
              icon: _carIcon ??
                  BitmapDescriptor.defaultMarkerWithHue(
                      BitmapDescriptor.hueBlue),
            ),
          );
          _isMapLoading = false;
        });
      }

      mapController
          ?.animateCamera(CameraUpdate.newLatLngZoom(currentLocation, 15.0));

      if (showMessage && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Location found!'),
            duration: Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      debugPrint('Location error: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to get location: ${e.toString()}'),
            duration: const Duration(seconds: 5),
          ),
        );
      }
      if (mounted) {
        setState(() {
          _isMapLoading = false;
        });
      }
    }
  }

  void _addMarker() async {
    final LatLng center = await mapController!.getLatLng(
      ScreenCoordinate(
        x: MediaQuery.of(context).size.width.round() ~/ 2,
        y: MediaQuery.of(context).size.height.round() ~/ 2,
      ),
    );

    setState(() {
      _markers.add(
        Marker(
          markerId: MarkerId(center.toString()),
          position: center,
          infoWindow: const InfoWindow(
            title: 'New Marker',
            snippet: 'This is a new marker',
          ),
          icon: BitmapDescriptor.defaultMarker,
        ),
      );
    });
  }

  void _showLocationHelp() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.help_outline, color: Colors.blue),
            SizedBox(width: 8),
            Text('Enable Location'),
          ],
        ),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'To use GPS navigation, you need to:',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 12),
              Text(
                  '1. Click the location icon (🎯) in your browser address bar'),
              SizedBox(height: 8),
              Text('2. Select "Allow" when prompted for location access'),
              SizedBox(height: 8),
              Text('3. Click the "My Location" button (📍) below'),
              SizedBox(height: 12),
              Text(
                'Note: Location services must be enabled on your device.',
                style: TextStyle(fontStyle: FontStyle.italic, fontSize: 12),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Got it'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.of(context).pop();
              _getCurrentLocation(showMessage: true);
            },
            child: const Text('Try Now'),
          ),
        ],
      ),
    );
  }

  Future<void> _saveCurrentPlace() async {
    if (_currentPosition == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enable location first')),
        );
      }
      return;
    }

    _showSavePlaceDialog(_currentPosition!);
  }

  Future<void> _showSavePlaceDialog(LatLng location) async {
    final nameController = TextEditingController();
    String selectedCategory = 'Favorite';

    final result = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Save Place'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(
                  labelText: 'Place Name',
                  hintText: 'e.g., Home, Office, Favorite Restaurant',
                ),
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: selectedCategory,
                decoration: const InputDecoration(labelText: 'Category'),
                items: const [
                  DropdownMenuItem(value: 'Home', child: Text('🏠 Home')),
                  DropdownMenuItem(value: 'Work', child: Text('💼 Work')),
                  DropdownMenuItem(
                      value: 'Favorite', child: Text('❤️ Favorite')),
                  DropdownMenuItem(
                      value: 'Restaurant', child: Text('🍽️ Restaurant')),
                  DropdownMenuItem(
                      value: 'Shopping', child: Text('🛍️ Shopping')),
                  DropdownMenuItem(value: 'Other', child: Text('📍 Other')),
                ],
                onChanged: (value) {
                  setState(() => selectedCategory = value!);
                },
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );

    if (result == true && nameController.text.isNotEmpty) {
      try {
        final place = SavedPlace(
          name: nameController.text,
          address:
              'Lat: ${location.latitude.toStringAsFixed(6)}, Lng: ${location.longitude.toStringAsFixed(6)}',
          latitude: location.latitude,
          longitude: location.longitude,
          category: selectedCategory,
        );
        await DatabaseHelper.instance.create(place);
        await _loadSavedPlaces();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Place saved successfully!')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error saving place: $e')),
          );
        }
      }
    }
  }

  void _toggleTraffic() {
    setState(() {
      _showTraffic = !_showTraffic;
    });
    _prefs?.setBool('showTraffic', _showTraffic);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_showTraffic
              ? 'Traffic layer enabled'
              : 'Traffic layer disabled'),
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  void _navigateToSavedPlaces() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => SavedPlacesScreen(
          onPlaceSelected: (location, name) {
            mapController?.animateCamera(
              CameraUpdate.newLatLngZoom(location, 15.0),
            );
            setState(() {
              _markers.add(
                Marker(
                  markerId: MarkerId(name),
                  position: location,
                  infoWindow: InfoWindow(title: name),
                ),
              );
            });
          },
        ),
      ),
    );
  }

  void onSearch() async {
    final String query = searchController.text;
    if (query.isEmpty) {
      return;
    }

    final String apiKey = dotenv.env['GOOGLE_MAPS_API_KEY']!;
    final String url =
        'https://maps.googleapis.com/maps/api/geocode/json?address=$query&components=country:NG&key=$apiKey';

    debugPrint('Search URL: $url');
    try {
      final response = await http.get(Uri.parse(url));
      debugPrint('Search Response Status: ${response.statusCode}');
      debugPrint('Search Response Body: ${response.body}');
      final data = json.decode(response.body);

      if (data['status'] == 'OK') {
        final double lat = data['results'][0]['geometry']['location']['lat'];
        final double lng = data['results'][0]['geometry']['location']['lng'];
        final LatLng location = LatLng(lat, lng);

        mapController
            ?.animateCamera(CameraUpdate.newLatLngZoom(location, 15.0));
        setState(() {
          _markers.add(
            Marker(
              markerId: MarkerId(location.toString()),
              position: location,
              infoWindow: InfoWindow(
                title: query,
              ),
            ),
          );
          _suggestions = [];
        });
      } else {
        debugPrint(
            'Search Error: ${data['status']} - ${data['error_message'] ?? 'No error message'}');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Search failed: ${data['status']}')),
          );
        }
      }
    } catch (e) {
      debugPrint('Search Exception: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Search failed: Network error')),
        );
      }
    }
  }

  void _onSearchChanged(String query) async {
    if (query.isEmpty) {
      setState(() {
        _suggestions = [];
      });
      return;
    }

    if (query.length < 2) {
      return;
    }

    final String apiKey = dotenv.env['GOOGLE_MAPS_API_KEY']!;
    final String url =
        'https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${Uri.encodeComponent(query)}&components=country:ng&types=geocode|establishment&key=$apiKey';

    debugPrint('Autocomplete URL: $url');
    try {
      final response = await http.get(Uri.parse(url));
      debugPrint('Autocomplete Response Status: ${response.statusCode}');
      debugPrint('Autocomplete Response Body: ${response.body}');
      final data = json.decode(response.body);

      if (data['status'] == 'OK') {
        final List predictions = data['predictions'];
        setState(() {
          _suggestions = predictions
              .map<String>((p) => p['description'] as String)
              .toList();
        });
      } else if (data['status'] == 'ZERO_RESULTS') {
        setState(() {
          _suggestions = [];
        });
      } else {
        debugPrint(
            'Autocomplete Error: ${data['status']} - ${data['error_message'] ?? 'No error message'}');
        setState(() {
          _suggestions = [];
        });
      }
    } catch (e) {
      debugPrint('Autocomplete Exception: $e');
      setState(() {
        _suggestions = [];
      });
    }
  }

  void getDirections() async {
    final String originAddress = originController.text;
    final String destinationAddress = destinationController.text;

    if (originAddress.isEmpty || destinationAddress.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Please enter both origin and destination')),
        );
      }
      return;
    }

    final String apiKey = dotenv.env['GOOGLE_MAPS_API_KEY']!;
    final String directionsUrl =
        'https://maps.googleapis.com/maps/api/directions/json?origin=${Uri.encodeComponent(originAddress)}&destination=${Uri.encodeComponent(destinationAddress)}&mode=$_travelMode&region=ng&key=$apiKey';

    final String url =
        'https://api.allorigins.win/raw?url=${Uri.encodeComponent(directionsUrl)}';

    debugPrint('Directions URL: $directionsUrl');
    try {
      final response = await http.get(Uri.parse(url)).timeout(
            const Duration(seconds: 15),
            onTimeout: () =>
                throw TimeoutException('Directions request timed out'),
          );
      debugPrint('Directions Response Status: ${response.statusCode}');
      debugPrint('Directions Response Body: ${response.body}');
      final data = json.decode(response.body);

      if (data['status'] == 'OK' && (data['routes'] as List).isNotEmpty) {
        final String encodedPolyline =
            data['routes'][0]['overview_polyline']['points'] as String;
        final List<LatLng> polylineCoordinates =
            _decodePolyline(encodedPolyline);

        final bounds = data['routes'][0]['bounds'];
        final northeast = LatLng(
          bounds['northeast']['lat'],
          bounds['northeast']['lng'],
        );
        final southwest = LatLng(
          bounds['southwest']['lat'],
          bounds['southwest']['lng'],
        );

        final leg = data['routes'][0]['legs'][0];
        final steps = leg['steps'] as List;

        if (mounted) {
          setState(() {
            _polylines.clear();
            _polylines.add(
              Polyline(
                polylineId: const PolylineId('route'),
                points: polylineCoordinates,
                color: Colors.blue,
                width: 5,
              ),
            );
            _distance = leg['distance']['text'];
            _eta = leg['duration']['text'];
            _instructions = steps
                .map<String>((step) =>
                    _stripHtmlTags(step['html_instructions'] as String))
                .toList();

            _navigationSteps = steps
                .map<Map<String, dynamic>>((step) => {
                      'instruction':
                          _stripHtmlTags(step['html_instructions'] as String),
                      'distance': step['distance']['value'],
                      'duration': step['duration']['value'],
                      'end_location': step['end_location'],
                    })
                .toList();

            _destination = LatLng(
              leg['end_location']['lat'],
              leg['end_location']['lng'],
            );
          });
        }

        mapController?.animateCamera(
          CameraUpdate.newLatLngBounds(
            LatLngBounds(southwest: southwest, northeast: northeast),
            50,
          ),
        );
      } else {
        final errorMsg =
            data['error_message'] ?? data['status'] ?? 'Unknown error';
        debugPrint('Error getting directions: ${data['status']} - $errorMsg');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Directions failed: $errorMsg'),
              duration: const Duration(seconds: 5),
            ),
          );
        }
      }
    } on TimeoutException catch (e) {
      debugPrint('Directions Timeout: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Request timed out: ${e.toString()}'),
            duration: const Duration(seconds: 5),
          ),
        );
      }
    } catch (e, stackTrace) {
      debugPrint('Directions Exception: $e');
      debugPrint('Stack trace: $stackTrace');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to get directions: ${e.toString()}'),
            duration: const Duration(seconds: 5),
          ),
        );
      }
    }
  }

  String _stripHtmlTags(String htmlString) {
    final RegExp exp = RegExp(r'<[^>]*>', multiLine: true, caseSensitive: true);
    return htmlString.replaceAll(exp, '').replaceAll('&nbsp;', ' ');
  }

  double _calculateDistance(LatLng pos1, LatLng pos2) {
    const p = 0.017453292519943295;
    final a = 0.5 -
        cos((pos2.latitude - pos1.latitude) * p) / 2 +
        cos(pos1.latitude * p) *
            cos(pos2.latitude * p) *
            (1 - cos((pos2.longitude - pos1.longitude) * p)) /
            2;
    return 12742000 * asin(sqrt(a));
  }

  Future<void> _startNavigation() async {
    if (_navigationSteps.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please get directions first')),
        );
      }
      return;
    }

    await _positionStream?.cancel();

    if (mounted) {
      setState(() {
        _isNavigating = true;
        _currentStepIndex = 0;
      });
    }

    await _flutterTts?.speak(
      "Navigation started. ${_navigationSteps[0]['instruction']}",
    );

    final locationSettings = LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 10,
    );

    _positionStream = Geolocator.getPositionStream(
      locationSettings: locationSettings,
    ).listen((position) {
      if (!mounted || _navigationSteps.isEmpty) return;
      if (_currentStepIndex >= _navigationSteps.length) return;

      final currentPos = LatLng(position.latitude, position.longitude);

      if (mounted) {
        setState(() {
          _currentPosition = currentPos;
          _markers.removeWhere((m) => m.markerId.value == 'currentLocation');
          _markers.add(
            Marker(
              markerId: const MarkerId('currentLocation'),
              position: currentPos,
              infoWindow: const InfoWindow(title: 'Your Location'),
              icon: _carIcon ??
                  BitmapDescriptor.defaultMarkerWithHue(
                      BitmapDescriptor.hueBlue),
              rotation: position.heading,
            ),
          );
        });
      }

      mapController?.animateCamera(
        CameraUpdate.newCameraPosition(
          CameraPosition(
            target: currentPos,
            zoom: 18.0,
            bearing: position.heading,
            tilt: 45.0,
          ),
        ),
      );

      final step = _navigationSteps[_currentStepIndex];
      final endLocation = step['end_location'] as Map<String, dynamic>;
      final stepLocation = LatLng(
        (endLocation['lat'] as num).toDouble(),
        (endLocation['lng'] as num).toDouble(),
      );

      final distanceToStep = _calculateDistance(currentPos, stepLocation);

      if (distanceToStep < 50) {
        _currentStepIndex++;
        if (_currentStepIndex < _navigationSteps.length) {
          final nextStep = _navigationSteps[_currentStepIndex];
          _flutterTts?.speak(nextStep['instruction'] as String);
        } else {
          _flutterTts?.speak("You have arrived at your destination");
          _stopNavigation();
        }
      } else if (distanceToStep < 200) {
        final distance = distanceToStep.round();
        _flutterTts?.speak("In $distance meters, ${step['instruction']}");
      }
    });
  }

  Future<void> _stopNavigation() async {
    await _positionStream?.cancel();
    _positionStream = null;

    if (mounted) {
      setState(() {
        _isNavigating = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Google Maps - Nigeria"),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.help_outline),
            tooltip: 'Location Help',
            onPressed: _showLocationHelp,
          ),
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () {
              showSearch(
                context: context,
                delegate: CustomSearchDelegate(),
              );
            },
          ),
        ],
      ),
      drawer: Drawer(
        child: ListView(
          padding: EdgeInsets.zero,
          children: <Widget>[
            const DrawerHeader(
              decoration: BoxDecoration(
                color: Colors.blue,
              ),
              child: Text(
                'Map Features',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                ),
              ),
            ),
            ExpansionTile(
              leading: const Icon(Icons.layers),
              title: const Text('Map Layers'),
              children: <Widget>[
                ListTile(
                  title: const Text('Normal'),
                  onTap: () {
                    setState(() {
                      _currentMapType = MapType.normal;
                    });
                    Navigator.of(context).pop();
                  },
                ),
                ListTile(
                  title: const Text('Satellite'),
                  onTap: () {
                    setState(() {
                      _currentMapType = MapType.satellite;
                    });
                    Navigator.of(context).pop();
                  },
                ),
                ListTile(
                  title: const Text('Terrain'),
                  onTap: () {
                    setState(() {
                      _currentMapType = MapType.terrain;
                    });
                    Navigator.of(context).pop();
                  },
                ),
                ListTile(
                  title: const Text('Hybrid'),
                  onTap: () {
                    setState(() {
                      _currentMapType = MapType.hybrid;
                    });
                    Navigator.of(context).pop();
                  },
                ),
              ],
            ),
            ListTile(
              leading: const Icon(Icons.bookmark),
              title: const Text('Saved Places'),
              trailing: Text('${_savedPlaces.length}'),
              onTap: () {
                Navigator.of(context).pop();
                _navigateToSavedPlaces();
              },
            ),
            SwitchListTile(
              secondary: const Icon(Icons.traffic),
              title: const Text('Traffic Layer'),
              subtitle: Text(_showTraffic ? 'Showing traffic' : 'Hidden'),
              value: _showTraffic,
              onChanged: (value) {
                _toggleTraffic();
              },
            ),
            ListTile(
              leading: const Icon(Icons.save_alt),
              title: const Text('Save Current Location'),
              onTap: () {
                Navigator.of(context).pop();
                _saveCurrentPlace();
              },
            ),
            ListTile(
              leading: const Icon(Icons.offline_pin),
              title: const Text('Offline Maps'),
              onTap: () {
                Navigator.of(context).pop();
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => const OfflineMapsScreen(),
                  ),
                );
              },
            ),
            const Divider(),
            ExpansionTile(
              leading: const Icon(Icons.directions),
              title: const Text('Directions'),
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: TextField(
                    controller: originController,
                    decoration: const InputDecoration(
                      labelText: 'Origin',
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: TextField(
                    controller: destinationController,
                    decoration: const InputDecoration(
                      labelText: 'Destination',
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: DropdownButton<String>(
                    value: _travelMode,
                    items: const [
                      DropdownMenuItem(
                          value: 'driving', child: Text('Driving')),
                      DropdownMenuItem(
                          value: 'walking', child: Text('Walking')),
                      DropdownMenuItem(
                          value: 'bicycling', child: Text('Bicycling')),
                      DropdownMenuItem(
                          value: 'transit', child: Text('Transit')),
                    ],
                    onChanged: (value) {
                      setState(() {
                        _travelMode = value!;
                      });
                    },
                  ),
                ),
                ElevatedButton(
                  onPressed: getDirections,
                  child: const Text('Get Directions'),
                ),
              ],
            ),
          ],
        ),
      ),
      body: Stack(
        children: [
          GoogleMap(
            initialCameraPosition: const CameraPosition(
              target: LatLng(9.0820, 8.6753),
              zoom: 5.0,
            ),
            mapType: _currentMapType,
            onMapCreated: onMapCreated,
            markers: _markers,
            polylines: _polylines,
            padding: const EdgeInsets.only(bottom: 100, right: 10),
            zoomControlsEnabled: true,
            myLocationEnabled: true,
            myLocationButtonEnabled: false,
            trafficEnabled: _showTraffic,
            onLongPress: _showSavePlaceDialog,
          ),
          Positioned(
            top: 10,
            left: 10,
            right: 10,
            child: Column(
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8.0),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: searchController,
                            decoration: const InputDecoration(
                              hintText: 'Search for a location',
                              border: InputBorder.none,
                            ),
                            onChanged: _onSearchChanged,
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.search),
                          onPressed: onSearch,
                        ),
                      ],
                    ),
                  ),
                ),
                if (_suggestions.isNotEmpty)
                  Card(
                    child: SizedBox(
                      height: 200,
                      child: ListView.builder(
                        itemCount: _suggestions.length,
                        itemBuilder: (context, index) {
                          return ListTile(
                            title: Text(_suggestions[index]),
                            onTap: () {
                              searchController.text = _suggestions[index];
                              onSearch();
                            },
                          );
                        },
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (_isMapLoading)
            Container(
              color: Colors.black54,
              child: const Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    CircularProgressIndicator(
                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                    SizedBox(height: 16),
                    Text(
                      "Loading map...",
                      style: TextStyle(color: Colors.white, fontSize: 16),
                    ),
                  ],
                ),
              ),
            ),
          if (_errorMessage != null)
            Container(
              color: Colors.white,
              child: Center(
                child: Text(
                  _errorMessage!,
                  style: const TextStyle(color: Colors.red, fontSize: 16),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          if (_isNavigating && _currentStepIndex < _navigationSteps.length)
            Positioned(
              top: 80,
              left: 10,
              right: 10,
              child: Card(
                color: Colors.blue.shade700,
                child: Padding(
                  padding: const EdgeInsets.all(12.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.navigation, color: Colors.white),
                          const SizedBox(width: 8),
                          const Text(
                            'Navigating',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _navigationSteps[_currentStepIndex]['instruction'],
                        style:
                            const TextStyle(color: Colors.white, fontSize: 14),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          if (_eta != null && _distance != null)
            Positioned(
              bottom: 80,
              left: 10,
              right: 10,
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Distance: $_distance',
                              style:
                                  const TextStyle(fontWeight: FontWeight.bold)),
                          Text('ETA: $_eta',
                              style:
                                  const TextStyle(fontWeight: FontWeight.bold)),
                        ],
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          ElevatedButton.icon(
                            onPressed: () {
                              showDialog(
                                context: context,
                                builder: (context) => AlertDialog(
                                  title:
                                      const Text('Turn-by-Turn Instructions'),
                                  content: SizedBox(
                                    width: double.maxFinite,
                                    child: ListView.builder(
                                      itemCount: _instructions.length,
                                      itemBuilder: (context, index) {
                                        return ListTile(
                                          leading: CircleAvatar(
                                            child: Text('${index + 1}'),
                                          ),
                                          title: Text(_instructions[index]),
                                        );
                                      },
                                    ),
                                  ),
                                  actions: [
                                    TextButton(
                                      onPressed: () =>
                                          Navigator.of(context).pop(),
                                      child: const Text('Close'),
                                    ),
                                  ],
                                ),
                              );
                            },
                            icon: const Icon(Icons.list),
                            label: const Text('Instructions'),
                          ),
                          ElevatedButton.icon(
                            onPressed: _isNavigating
                                ? _stopNavigation
                                : _startNavigation,
                            icon: Icon(
                                _isNavigating ? Icons.stop : Icons.navigation),
                            label: Text(
                                _isNavigating ? 'Stop' : 'Start Navigation'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor:
                                  _isNavigating ? Colors.red : Colors.green,
                              foregroundColor: Colors.white,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
      floatingActionButton: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          FloatingActionButton(
            heroTag: 'myLocation',
            onPressed: () => _getCurrentLocation(showMessage: true),
            tooltip: 'My Location',
            child: const Icon(Icons.my_location),
          ),
          const SizedBox(height: 10),
          FloatingActionButton(
            heroTag: 'addMarker',
            onPressed: _addMarker,
            tooltip: 'Add Marker',
            child: const Icon(Icons.add_location),
          ),
        ],
      ),
    );
  }
}

class CustomSearchDelegate extends SearchDelegate {
  @override
  List<Widget> buildActions(BuildContext context) {
    return [
      IconButton(
        icon: const Icon(Icons.clear),
        onPressed: () {
          query = '';
        },
      ),
    ];
  }

  @override
  Widget buildLeading(BuildContext context) {
    return IconButton(
      icon: const Icon(Icons.arrow_back),
      onPressed: () {
        close(context, null);
      },
    );
  }

  @override
  Widget buildResults(BuildContext context) {
    // Access the state of the MapScreen to call the search function
    final MapScreenState state = MapScreen.mapKey.currentState!;
    state.searchController.text = query;
    state.onSearch();
    return const Center(
      child: Text("Searching..."),
    );
  }

  @override
  Widget buildSuggestions(BuildContext context) {
    return Container();
  }
}
