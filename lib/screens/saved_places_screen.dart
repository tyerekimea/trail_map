import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../models/saved_place.dart';
import '../services/database_helper.dart';

class SavedPlacesScreen extends StatefulWidget {
  final Function(LatLng, String) onPlaceSelected;
  final Future<void> Function()? onPlacesChanged;

  const SavedPlacesScreen({
    super.key,
    required this.onPlaceSelected,
    this.onPlacesChanged,
  });

  @override
  State<SavedPlacesScreen> createState() => _SavedPlacesScreenState();
}

class _SavedPlacesScreenState extends State<SavedPlacesScreen> {
  List<SavedPlace> _places = [];
  String _selectedCategory = 'All';
  bool _isLoading = true;

  final List<String> _categories = [
    'All',
    'Home',
    'Work',
    'Favorite',
    'Restaurant',
    'Shopping',
    'Other',
  ];

  @override
  void initState() {
    super.initState();
    _loadPlaces();
  }

  Future<void> _loadPlaces() async {
    setState(() => _isLoading = true);
    try {
      final places = _selectedCategory == 'All'
          ? await DatabaseHelper.instance.readAll()
          : await DatabaseHelper.instance.readByCategory(_selectedCategory);
      setState(() {
        _places = places;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error loading places: $e')),
        );
      }
    }
  }

  Future<void> _deletePlace(SavedPlace place) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Place'),
        content: Text('Are you sure you want to delete "${place.name}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirm == true && place.id != null) {
      await DatabaseHelper.instance.softDelete(place.id!);
      await _loadPlaces();
      if (widget.onPlacesChanged != null) {
        await widget.onPlacesChanged!.call();
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Place deleted locally')),
        );
      }
    }
  }

  IconData _getCategoryIcon(String category) {
    switch (category) {
      case 'Home':
        return Icons.home;
      case 'Work':
        return Icons.work;
      case 'Favorite':
        return Icons.favorite;
      case 'Restaurant':
        return Icons.restaurant;
      case 'Shopping':
        return Icons.shopping_bag;
      default:
        return Icons.place;
    }
  }

  Color _getCategoryColor(String category) {
    switch (category) {
      case 'Home':
        return Colors.blue;
      case 'Work':
        return Colors.orange;
      case 'Favorite':
        return Colors.red;
      case 'Restaurant':
        return Colors.green;
      case 'Shopping':
        return Colors.purple;
      default:
        return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Saved Places'),
        actions: [
          IconButton(
            icon: const Icon(Icons.info_outline),
            onPressed: () {
              showDialog(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('How to Save Places'),
                  content: const Text(
                    '1. Long press on any location on the map\n'
                    '2. Tap "Save Place" in the popup\n'
                    '3. Choose a category and name\n'
                    '4. Access saved places anytime from here',
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Got it'),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            height: 60,
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              itemCount: _categories.length,
              itemBuilder: (context, index) {
                final category = _categories[index];
                final isSelected = category == _selectedCategory;
                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: FilterChip(
                    label: Text(category),
                    selected: isSelected,
                    onSelected: (selected) {
                      setState(() => _selectedCategory = category);
                      _loadPlaces();
                    },
                    selectedColor: Colors.blue.shade100,
                  ),
                );
              },
            ),
          ),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _places.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.place_outlined,
                                size: 64, color: Colors.grey.shade400),
                            const SizedBox(height: 16),
                            Text(
                              'No saved places yet',
                              style: TextStyle(
                                fontSize: 18,
                                color: Colors.grey.shade600,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Long press on the map to save a place',
                              style: TextStyle(color: Colors.grey.shade500),
                            ),
                          ],
                        ),
                      )
                    : ListView.builder(
                        itemCount: _places.length,
                        itemBuilder: (context, index) {
                          final place = _places[index];
                          return Card(
                            margin: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            child: ListTile(
                              leading: CircleAvatar(
                                backgroundColor:
                                    _getCategoryColor(place.category),
                                child: Icon(
                                  _getCategoryIcon(place.category),
                                  color: Colors.white,
                                ),
                              ),
                              title: Text(
                                place.name,
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold),
                              ),
                              subtitle: Text(
                                place.address,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              trailing: IconButton(
                                icon: const Icon(Icons.delete_outline),
                                color: Colors.red,
                                onPressed: () => _deletePlace(place),
                              ),
                              onTap: () {
                                widget.onPlaceSelected(
                                  LatLng(place.latitude, place.longitude),
                                  place.name,
                                );
                                Navigator.pop(context);
                              },
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
