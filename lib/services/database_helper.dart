import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'package:path_provider/path_provider.dart';
import '../models/saved_place.dart';

class DatabaseHelper {
  static final DatabaseHelper instance = DatabaseHelper._init();
  static Database? _database;

  DatabaseHelper._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('saved_places.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 1,
      onCreate: _createDB,
    );
  }

  Future _createDB(Database db, int version) async {
    await db.execute('''
      CREATE TABLE saved_places (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        category TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )
    ''');
  }

  Future<SavedPlace> create(SavedPlace place) async {
    final db = await instance.database;
    final id = await db.insert('saved_places', place.toMap());
    return place.copyWith(id: id);
  }

  Future<List<SavedPlace>> readAll() async {
    final db = await instance.database;
    const orderBy = 'createdAt DESC';
    final result = await db.query('saved_places', orderBy: orderBy);
    return result.map((json) => SavedPlace.fromMap(json)).toList();
  }

  Future<List<SavedPlace>> readByCategory(String category) async {
    final db = await instance.database;
    final result = await db.query(
      'saved_places',
      where: 'category = ?',
      whereArgs: [category],
      orderBy: 'createdAt DESC',
    );
    return result.map((json) => SavedPlace.fromMap(json)).toList();
  }

  Future<int> update(SavedPlace place) async {
    final db = await instance.database;
    return db.update(
      'saved_places',
      place.toMap(),
      where: 'id = ?',
      whereArgs: [place.id],
    );
  }

  Future<int> delete(int id) async {
    final db = await instance.database;
    return await db.delete(
      'saved_places',
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future close() async {
    final db = await instance.database;
    db.close();
  }
}

extension SavedPlaceExtension on SavedPlace {
  SavedPlace copyWith({
    int? id,
    String? name,
    String? address,
    double? latitude,
    double? longitude,
    String? category,
    DateTime? createdAt,
  }) {
    return SavedPlace(
      id: id ?? this.id,
      name: name ?? this.name,
      address: address ?? this.address,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      category: category ?? this.category,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
