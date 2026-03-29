import 'dart:async';
import 'dart:ui' as ui;
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:math' show cos, sqrt, asin;
import 'models/saved_place.dart';
import 'services/api_client.dart';
import 'services/auth_session.dart';
import 'services/database_helper.dart';
import 'services/maps_service.dart';
import 'services/places_service.dart';
import 'screens/auth_screen.dart';
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
    return const MaterialApp(
      title: 'Google Maps Nigeria App',
      debugShowCheckedModeBanner: false,
      home: AuthGate(),
    );
  }
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool _isCheckingSession = true;
  bool _isAuthenticated = false;

  @override
  void initState() {
    super.initState();
    _checkSession();
  }

  Future<void> _checkSession() async {
    final hasSession = await AuthSession.instance.hasSession();
    if (!mounted) return;
    setState(() {
      _isAuthenticated = hasSession;
      _isCheckingSession = false;
    });
  }

  Future<void> _handleAuthenticated() async {
    if (!mounted) return;
    setState(() {
      _isAuthenticated = true;
    });
  }

  Future<void> _handleLogout() async {
    await AuthSession.instance.clearSession();
    if (!mounted) return;
    setState(() {
      _isAuthenticated = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_isCheckingSession) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (_isAuthenticated) {
      return MapScreen(
        key: MapScreen.mapKey,
        onLogout: _handleLogout,
      );
    }

    return AuthScreen(onAuthenticated: _handleAuthenticated);
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

enum DirectionsStartMode {
  currentLocation,
  customLocation,
}

class MapScreen extends StatefulWidget {
  const MapScreen({super.key, this.onLogout});

  final Future<void> Function()? onLogout;

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
  bool _showDirectionsPanel = false;
  DirectionsStartMode _directionsStartMode =
      DirectionsStartMode.currentLocation;
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

  // Traffic and offline maps
  bool _showTraffic = false;
  List<SavedPlace> _savedPlaces = [];
  SharedPreferences? _prefs;
  final MapsService _mapsService = MapsService();
  final PlacesService _placesService = PlacesService();
  bool _isSyncingPlaces = false;
  bool _hasQueuedSync = false;
  static const _placesLastSyncKey = 'places_last_sync_at';

  @override
  void initState() {
    super.initState();
    _createCarIcon();
    _initTts();
    _initPreferences();
    _loadSavedPlaces();
    final backendBaseUrl = dotenv.env['BACKEND_BASE_URL']?.trim() ?? '';
    debugPrint(
        'Backend URL loaded: ${backendBaseUrl.isNotEmpty ? 'Yes' : 'No'}');
    if (backendBaseUrl.isEmpty) {
      setState(() {
        _isMapLoading = false;
        _errorMessage =
            'Backend URL is missing. Please set BACKEND_BASE_URL in .env.';
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

  DateTime? _getLastSyncAt() {
    final value = _prefs?.getString(_placesLastSyncKey);
    if (value == null || value.isEmpty) return null;
    return DateTime.tryParse(value)?.toUtc();
  }

  void _setLastSyncAt(DateTime timestamp) {
    _prefs?.setString(_placesLastSyncKey, timestamp.toUtc().toIso8601String());
  }

  void _queuePlacesSync() {
    if (_isSyncingPlaces) {
      _hasQueuedSync = true;
      return;
    }
    unawaited(_syncPlacesIfAuthenticated());
  }

  List<Map<String, dynamic>> _extractSyncRecords(Map<String, dynamic> payload) {
    final dynamic data = payload['data'];
    if (data is! Map<String, dynamic>) return [];
    final dynamic records = data['records'];
    if (records is! List) return [];
    return records.whereType<Map<String, dynamic>>().toList();
  }

  DateTime? _extractServerTime(Map<String, dynamic> payload) {
    final dynamic data = payload['data'];
    if (data is! Map<String, dynamic>) return null;
    final raw = data['serverTime']?.toString();
    if (raw == null || raw.isEmpty) return null;
    return DateTime.tryParse(raw)?.toUtc();
  }

  Future<void> _syncPlacesIfAuthenticated({bool showMessage = false}) async {
    if (_isSyncingPlaces) {
      _hasQueuedSync = true;
      return;
    }

    final hasSession = await AuthSession.instance.hasSession();
    if (!hasSession) {
      debugPrint('Skipping places sync: no active session.');
      return;
    }

    if (mounted) {
      setState(() {
        _isSyncingPlaces = true;
      });
    } else {
      _isSyncingPlaces = true;
    }

    try {
      final dirtyPlaces = await DatabaseHelper.instance.getDirtyPlaces();
      if (dirtyPlaces.isNotEmpty) {
        final pushResponse = await _placesService.pushBatch(dirtyPlaces);
        final pushedRecords = _extractSyncRecords(pushResponse);
        await DatabaseHelper.instance.upsertFromServerRecords(pushedRecords);
      }

      final pullResponse =
          await _placesService.pullSince(since: _getLastSyncAt());
      final pulledRecords = _extractSyncRecords(pullResponse);
      await DatabaseHelper.instance.upsertFromServerRecords(pulledRecords);

      await _loadSavedPlaces();

      _setLastSyncAt(
          _extractServerTime(pullResponse) ?? DateTime.now().toUtc());

      if (showMessage && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content:
                  Text('Sync complete (${dirtyPlaces.length} upload changes)')),
        );
      }
    } on ApiException catch (e) {
      debugPrint('Places sync failed (${e.statusCode}): ${e.message}');
      if (e.statusCode == 401) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Session expired. Please login again.'),
            ),
          );
        }
        await _logout();
      } else if (showMessage && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Sync failed: ${e.message}')),
        );
      }
    } catch (e) {
      debugPrint('Unexpected places sync error: $e');
      if (showMessage && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Sync failed. Please try again.')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSyncingPlaces = false;
        });
      } else {
        _isSyncingPlaces = false;
      }

      if (_hasQueuedSync) {
        _hasQueuedSync = false;
        _queuePlacesSync();
      }
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
        _carIcon = BitmapDescriptor.bytes(bytes!.buffer.asUint8List());
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
      const locationSettings = LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 15),
      );
      Position position = await Geolocator.getCurrentPosition(
        locationSettings: locationSettings,
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
    } on TimeoutException {
      debugPrint('Location request timed out.');
      if (showMessage && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Could not get location in time. Map is still available.',
            ),
            duration: Duration(seconds: 4),
          ),
        );
      }
      if (mounted) {
        setState(() {
          _isMapLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Location error: $e');
      if (showMessage && mounted) {
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
                initialValue: selectedCategory,
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
        final place = SavedPlace.newLocal(
          name: nameController.text,
          address:
              'Lat: ${location.latitude.toStringAsFixed(6)}, Lng: ${location.longitude.toStringAsFixed(6)}',
          latitude: location.latitude,
          longitude: location.longitude,
          category: selectedCategory,
        );
        await DatabaseHelper.instance.create(place);
        await _loadSavedPlaces();
        _queuePlacesSync();
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

  Future<void> _navigateToSavedPlaces() async {
    await Navigator.push(
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
          onPlacesChanged: () async {
            await _loadSavedPlaces();
            _queuePlacesSync();
          },
        ),
      ),
    );
    await _loadSavedPlaces();
    _queuePlacesSync();
  }

  Future<void> _logout() async {
    if (widget.onLogout != null) {
      await widget.onLogout!.call();
    }
  }

  void onSearch() async {
    final String query = searchController.text.trim();
    if (query.isEmpty) {
      return;
    }

    try {
      final data = await _mapsService.geocode(address: query, country: 'NG');
      debugPrint('Search Response Status: ${data['status']}');

      if (data['status'] == 'OK') {
        final Map<String, dynamic> locationData =
            data['results'][0]['geometry']['location'] as Map<String, dynamic>;
        final double lat = (locationData['lat'] as num).toDouble();
        final double lng = (locationData['lng'] as num).toDouble();
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
          destinationController.text = query;
          _showDirectionsPanel = true;
          _directionsStartMode = DirectionsStartMode.currentLocation;
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
    } on ApiException catch (e) {
      debugPrint('Search API Exception: ${e.message}');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Search failed: ${e.message}')),
        );
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

    try {
      final data = await _mapsService.autocomplete(
        input: query,
        country: 'ng',
        types: 'geocode|establishment',
      );
      debugPrint('Autocomplete Response Status: ${data['status']}');

      if (data['status'] == 'OK') {
        final List predictions = data['predictions'] as List;
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
    } on ApiException catch (e) {
      debugPrint('Autocomplete API Exception: ${e.message}');
      setState(() {
        _suggestions = [];
      });
    } catch (e) {
      debugPrint('Autocomplete Exception: $e');
      setState(() {
        _suggestions = [];
      });
    }
  }

  Future<bool> getDirections({required bool useCurrentLocation}) async {
    final String destinationAddress = destinationController.text.trim();
    if (destinationAddress.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Please search for a destination first')),
        );
      }
      return false;
    }

    String originAddress;
    if (useCurrentLocation) {
      if (_currentPosition == null) {
        await _getCurrentLocation(showMessage: true);
      }

      if (_currentPosition == null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Unable to get your current location'),
            ),
          );
        }
        return false;
      }

      originAddress =
          '${_currentPosition!.latitude},${_currentPosition!.longitude}';
    } else {
      originAddress = originController.text.trim();
      if (originAddress.isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Please enter a start location')),
          );
        }
        return false;
      }
    }

    try {
      final data = await _mapsService.directions(
        origin: originAddress,
        destination: destinationAddress,
        mode: _travelMode,
        region: 'ng',
      );
      debugPrint('Directions Response Status: ${data['status']}');

      if (data['status'] == 'OK' && (data['routes'] as List).isNotEmpty) {
        final String encodedPolyline =
            data['routes'][0]['overview_polyline']['points'] as String;
        final List<LatLng> polylineCoordinates =
            _decodePolyline(encodedPolyline);

        final Map<String, dynamic> bounds =
            data['routes'][0]['bounds'] as Map<String, dynamic>;
        final Map<String, dynamic> northeastData =
            bounds['northeast'] as Map<String, dynamic>;
        final Map<String, dynamic> southwestData =
            bounds['southwest'] as Map<String, dynamic>;
        final northeast = LatLng(
          (northeastData['lat'] as num).toDouble(),
          (northeastData['lng'] as num).toDouble(),
        );
        final southwest = LatLng(
          (southwestData['lat'] as num).toDouble(),
          (southwestData['lng'] as num).toDouble(),
        );

        final Map<String, dynamic> leg =
            data['routes'][0]['legs'][0] as Map<String, dynamic>;
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

          });
        }

        mapController?.animateCamera(
          CameraUpdate.newLatLngBounds(
            LatLngBounds(southwest: southwest, northeast: northeast),
            50,
          ),
        );
        return true;
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
        return false;
      }
    } on ApiException catch (e) {
      debugPrint('Directions API Exception: ${e.message}');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Directions failed: ${e.message}'),
            duration: const Duration(seconds: 5),
          ),
        );
      }
      return false;
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
      return false;
    }
  }

  Future<void> _handleGetDirectionsTap() async {
    if (mounted) {
      setState(() {
        _showDirectionsPanel = false;
      });
    }

    final bool success = await getDirections(
      useCurrentLocation:
          _directionsStartMode == DirectionsStartMode.currentLocation,
    );

    if (!success && mounted) {
      setState(() {
        _showDirectionsPanel = true;
      });
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

    const locationSettings = LocationSettings(
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

  Widget _buildDirectionsStartOption({
    required DirectionsStartMode mode,
    required IconData icon,
    required String label,
  }) {
    final bool isSelected = _directionsStartMode == mode;

    return Expanded(
      child: OutlinedButton.icon(
        onPressed: () {
          setState(() {
            _directionsStartMode = mode;
          });
        },
        icon: Icon(icon, color: isSelected ? Colors.white : Colors.blue),
        label: Text(
          label,
          style: TextStyle(color: isSelected ? Colors.white : Colors.blue),
        ),
        style: OutlinedButton.styleFrom(
          backgroundColor: isSelected ? Colors.blue : Colors.white,
          side: BorderSide(
            color: isSelected ? Colors.blue : Colors.grey.shade400,
          ),
        ),
      ),
    );
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
              onTap: () async {
                Navigator.of(context).pop();
                await _navigateToSavedPlaces();
              },
            ),
            ListTile(
              leading: const Icon(Icons.sync),
              title: const Text('Sync Saved Places'),
              trailing: _isSyncingPlaces
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : null,
              onTap: _isSyncingPlaces
                  ? null
                  : () async {
                      Navigator.of(context).pop();
                      await _syncPlacesIfAuthenticated(showMessage: true);
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
            if (widget.onLogout != null)
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Logout'),
                onTap: () async {
                  Navigator.of(context).pop();
                  await _logout();
                },
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
                if (_showDirectionsPanel)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.directions, color: Colors.blue),
                              SizedBox(width: 8),
                              Text(
                                'Directions',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Destination: ${destinationController.text}',
                            style: const TextStyle(color: Colors.black87),
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              _buildDirectionsStartOption(
                                mode: DirectionsStartMode.currentLocation,
                                icon: Icons.my_location,
                                label: 'Current location',
                              ),
                              const SizedBox(width: 8),
                              _buildDirectionsStartOption(
                                mode: DirectionsStartMode.customLocation,
                                icon: Icons.edit_location_alt,
                                label: 'Enter start',
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          if (_directionsStartMode ==
                              DirectionsStartMode.customLocation)
                            TextField(
                              controller: originController,
                              decoration: const InputDecoration(
                                labelText: 'Start location',
                                border: OutlineInputBorder(),
                              ),
                            )
                          else
                            const Text(
                              'Route will start from your live location.',
                            ),
                          const SizedBox(height: 10),
                          DropdownButtonFormField<String>(
                            initialValue: _travelMode,
                            decoration: const InputDecoration(
                              labelText: 'Travel mode',
                              border: OutlineInputBorder(),
                            ),
                            items: const [
                              DropdownMenuItem(
                                value: 'driving',
                                child: Text('Driving'),
                              ),
                              DropdownMenuItem(
                                value: 'walking',
                                child: Text('Walking'),
                              ),
                              DropdownMenuItem(
                                value: 'bicycling',
                                child: Text('Bicycling'),
                              ),
                              DropdownMenuItem(
                                value: 'transit',
                                child: Text('Transit'),
                              ),
                            ],
                            onChanged: (value) {
                              if (value == null) return;
                              setState(() {
                                _travelMode = value;
                              });
                            },
                          ),
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: _handleGetDirectionsTap,
                              icon: const Icon(Icons.route),
                              label: const Text('Get Directions'),
                            ),
                          ),
                        ],
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
                      const Row(
                        children: [
                          Icon(Icons.navigation, color: Colors.white),
                          SizedBox(width: 8),
                          Text(
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
              bottom: 96,
              left: 10,
              child: SizedBox(
                width: (MediaQuery.of(context).size.width - 20) * 0.8,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(6.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Distance: $_distance',
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  SizedBox(
                                    width: double.infinity,
                                    child: ElevatedButton.icon(
                                      onPressed: () {
                                        showDialog(
                                          context: context,
                                          builder: (context) => AlertDialog(
                                            title: const Text(
                                                'Turn-by-Turn Instructions'),
                                            content: SizedBox(
                                              width: double.maxFinite,
                                              child: ListView.builder(
                                                itemCount: _instructions.length,
                                                itemBuilder: (context, index) {
                                                  return ListTile(
                                                    leading: CircleAvatar(
                                                      child:
                                                          Text('${index + 1}'),
                                                    ),
                                                    title: Text(
                                                        _instructions[index]),
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
                                      icon: const Icon(Icons.list, size: 18),
                                      label: const Text(
                                        'Instructions',
                                        style: TextStyle(fontSize: 13),
                                      ),
                                      style: ElevatedButton.styleFrom(
                                        minimumSize: const Size(0, 38),
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 8,
                                          vertical: 8,
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Padding(
                                    padding: const EdgeInsets.only(left: 4),
                                    child: Text(
                                      'ETA: $_eta',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: ElevatedButton.icon(
                                onPressed: _isNavigating
                                    ? _stopNavigation
                                    : _startNavigation,
                                icon: Icon(
                                  _isNavigating ? Icons.stop : Icons.navigation,
                                  size: 18,
                                ),
                                label: Text(
                                  _isNavigating ? 'Stop' : 'Start',
                                  style: const TextStyle(fontSize: 13),
                                ),
                                style: ElevatedButton.styleFrom(
                                  minimumSize: const Size(0, 38),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 8,
                                  ),
                                  backgroundColor:
                                      _isNavigating ? Colors.red : Colors.green,
                                  foregroundColor: Colors.white,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
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
