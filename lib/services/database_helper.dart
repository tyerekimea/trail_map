import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
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
      version: 2,
      onCreate: _createDB,
      onUpgrade: _upgradeDB,
    );
  }

  Future _createDB(Database db, int version) async {
    await db.execute('''
      CREATE TABLE saved_places (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serverId TEXT,
        clientId TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        category TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        isDirty INTEGER NOT NULL DEFAULT 1,
        isDeleted INTEGER NOT NULL DEFAULT 0,
        lastSyncedAt TEXT
      )
    ''');
    await db.execute(
      'CREATE UNIQUE INDEX idx_saved_places_clientId ON saved_places(clientId)',
    );
    await db.execute(
      'CREATE INDEX idx_saved_places_sync ON saved_places(isDirty, updatedAt)',
    );
  }

  Future _upgradeDB(Database db, int oldVersion, int newVersion) async {
    if (oldVersion < 2) {
      await db.execute('ALTER TABLE saved_places ADD COLUMN serverId TEXT');
      await db.execute('ALTER TABLE saved_places ADD COLUMN clientId TEXT');
      await db.execute('ALTER TABLE saved_places ADD COLUMN updatedAt TEXT');
      await db.execute(
          'ALTER TABLE saved_places ADD COLUMN isDirty INTEGER NOT NULL DEFAULT 1');
      await db.execute(
          'ALTER TABLE saved_places ADD COLUMN isDeleted INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE saved_places ADD COLUMN lastSyncedAt TEXT');

      await db.execute('''
        UPDATE saved_places
        SET clientId = COALESCE(clientId, 'legacy_' || id),
            updatedAt = COALESCE(updatedAt, createdAt),
            isDirty = COALESCE(isDirty, 1),
            isDeleted = COALESCE(isDeleted, 0)
      ''');

      await db.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_places_clientId ON saved_places(clientId)',
      );
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_saved_places_sync ON saved_places(isDirty, updatedAt)',
      );
    }
  }

  Future<SavedPlace> create(SavedPlace place) async {
    final db = await instance.database;
    final now = DateTime.now();
    final placeToSave = place.clientId.isEmpty
        ? place.copyWith(
            clientId: SavedPlace.generateClientId(now),
            updatedAt: now,
            isDirty: true,
            isDeleted: false,
          )
        : place.copyWith(
            updatedAt: now,
            isDirty: true,
            isDeleted: false,
          );
    final id = await db.insert('saved_places', placeToSave.toMap());
    return placeToSave.copyWith(id: id);
  }

  Future<List<SavedPlace>> readAll({bool includeDeleted = false}) async {
    final db = await instance.database;
    const orderBy = 'createdAt DESC';
    final result = await db.query(
      'saved_places',
      where: includeDeleted ? null : 'isDeleted = ?',
      whereArgs: includeDeleted ? null : [0],
      orderBy: orderBy,
    );
    return result.map((json) => SavedPlace.fromMap(json)).toList();
  }

  Future<List<SavedPlace>> readByCategory(String category,
      {bool includeDeleted = false}) async {
    final db = await instance.database;
    final where =
        includeDeleted ? 'category = ?' : 'category = ? AND isDeleted = ?';
    final whereArgs = includeDeleted ? [category] : [category, 0];
    final result = await db.query(
      'saved_places',
      where: where,
      whereArgs: whereArgs,
      orderBy: 'createdAt DESC',
    );
    return result.map((json) => SavedPlace.fromMap(json)).toList();
  }

  Future<List<SavedPlace>> getDirtyPlaces() async {
    final db = await instance.database;
    final result = await db.query(
      'saved_places',
      where: 'isDirty = ?',
      whereArgs: [1],
      orderBy: 'updatedAt ASC',
    );
    return result.map((json) => SavedPlace.fromMap(json)).toList();
  }

  Future<int> update(SavedPlace place) async {
    final db = await instance.database;
    final updatedPlace = place.copyWith(
      updatedAt: DateTime.now(),
      isDirty: true,
    );
    return db.update(
      'saved_places',
      updatedPlace.toMap(),
      where: 'id = ?',
      whereArgs: [place.id],
    );
  }

  Future<int> softDelete(int id) async {
    final db = await instance.database;
    return db.update(
      'saved_places',
      {
        'isDeleted': 1,
        'isDirty': 1,
        'updatedAt': DateTime.now().toIso8601String(),
      },
      where: 'id = ?',
      whereArgs: [id],
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

  Future<void> upsertFromServerRecords(List<dynamic> records) async {
    if (records.isEmpty) return;
    final db = await instance.database;

    await db.transaction((txn) async {
      for (final raw in records) {
        if (raw is! Map<String, dynamic>) continue;
        final remote = SavedPlace.fromServerMap(raw);

        final existingRows = await txn.query(
          'saved_places',
          where: '(clientId = ?) OR (serverId = ?)',
          whereArgs: [remote.clientId, remote.serverId ?? ''],
          limit: 1,
        );

        if (remote.isDeleted) {
          if (existingRows.isNotEmpty) {
            await txn.delete(
              'saved_places',
              where: 'id = ?',
              whereArgs: [existingRows.first['id']],
            );
          }
          continue;
        }

        final merged = remote.copyWith(
          id: existingRows.isNotEmpty ? existingRows.first['id'] as int : null,
          isDirty: false,
          isDeleted: false,
          lastSyncedAt: DateTime.now(),
        );

        if (existingRows.isNotEmpty) {
          await txn.update(
            'saved_places',
            merged.toMap(),
            where: 'id = ?',
            whereArgs: [merged.id],
          );
        } else {
          await txn.insert('saved_places', merged.toMap());
        }
      }
    });
  }

  Future close() async {
    final db = await instance.database;
    db.close();
  }
}
