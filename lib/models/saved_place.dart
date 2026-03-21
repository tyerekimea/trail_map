import 'dart:math';

class SavedPlace {
  final int? id;
  final String? serverId;
  final String clientId;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final String category;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool isDirty;
  final bool isDeleted;
  final DateTime? lastSyncedAt;

  SavedPlace({
    this.id,
    this.serverId,
    required this.clientId,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    required this.category,
    DateTime? createdAt,
    DateTime? updatedAt,
    this.isDirty = true,
    this.isDeleted = false,
    this.lastSyncedAt,
  })  : createdAt = createdAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now();

  factory SavedPlace.newLocal({
    required String name,
    required String address,
    required double latitude,
    required double longitude,
    required String category,
  }) {
    final now = DateTime.now();
    return SavedPlace(
      clientId: generateClientId(now),
      name: name,
      address: address,
      latitude: latitude,
      longitude: longitude,
      category: category,
      createdAt: now,
      updatedAt: now,
      isDirty: true,
      isDeleted: false,
    );
  }

  static String generateClientId([DateTime? now]) {
    final timestamp = (now ?? DateTime.now()).microsecondsSinceEpoch;
    final random = Random().nextInt(1 << 32);
    return 'cp_${timestamp}_$random';
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'serverId': serverId,
      'clientId': clientId,
      'name': name,
      'address': address,
      'latitude': latitude,
      'longitude': longitude,
      'category': category,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
      'isDirty': isDirty ? 1 : 0,
      'isDeleted': isDeleted ? 1 : 0,
      'lastSyncedAt': lastSyncedAt?.toIso8601String(),
    };
  }

  Map<String, dynamic> toSyncPayload() {
    return {
      if (serverId != null && serverId!.isNotEmpty) 'serverId': serverId,
      'clientId': clientId,
      'name': name,
      'address': address,
      'latitude': latitude,
      'longitude': longitude,
      'category': category,
      'updatedAt': updatedAt.toIso8601String(),
      'isDeleted': isDeleted,
      if (isDeleted) 'deletedAt': updatedAt.toIso8601String(),
    };
  }

  factory SavedPlace.fromMap(Map<String, dynamic> map) {
    return SavedPlace(
      id: map['id'] as int?,
      serverId: map['serverId'] as String?,
      clientId: (map['clientId'] as String?) ?? generateClientId(),
      name: map['name'] as String,
      address: map['address'] as String,
      latitude: (map['latitude'] as num).toDouble(),
      longitude: (map['longitude'] as num).toDouble(),
      category: map['category'] as String,
      createdAt: DateTime.parse(map['createdAt'] as String),
      updatedAt: DateTime.parse(
        (map['updatedAt'] as String?) ?? map['createdAt'] as String,
      ),
      isDirty: (map['isDirty'] as int? ?? 0) == 1,
      isDeleted: (map['isDeleted'] as int? ?? 0) == 1,
      lastSyncedAt: map['lastSyncedAt'] == null
          ? null
          : DateTime.parse(map['lastSyncedAt'] as String),
    );
  }

  factory SavedPlace.fromServerMap(Map<String, dynamic> map) {
    final now = DateTime.now();
    final updatedAt = DateTime.tryParse('${map['updatedAt'] ?? ''}') ?? now;
    final createdAt =
        DateTime.tryParse('${map['createdAt'] ?? ''}') ?? updatedAt;
    final deletedAtRaw = map['deletedAt'];
    final isDeleted = map['isDeleted'] == true || deletedAtRaw != null;

    return SavedPlace(
      serverId: map['serverId']?.toString(),
      clientId: map['clientId']?.toString() ?? generateClientId(now),
      name: map['name']?.toString() ?? 'Untitled Place',
      address: map['address']?.toString() ?? 'Unknown Address',
      latitude: (map['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (map['longitude'] as num?)?.toDouble() ?? 0,
      category: map['category']?.toString() ?? 'Other',
      createdAt: createdAt,
      updatedAt: updatedAt,
      isDirty: false,
      isDeleted: isDeleted,
      lastSyncedAt: now,
    );
  }

  SavedPlace copyWith({
    int? id,
    String? serverId,
    String? clientId,
    String? name,
    String? address,
    double? latitude,
    double? longitude,
    String? category,
    DateTime? createdAt,
    DateTime? updatedAt,
    bool? isDirty,
    bool? isDeleted,
    DateTime? lastSyncedAt,
  }) {
    return SavedPlace(
      id: id ?? this.id,
      serverId: serverId ?? this.serverId,
      clientId: clientId ?? this.clientId,
      name: name ?? this.name,
      address: address ?? this.address,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      category: category ?? this.category,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      isDirty: isDirty ?? this.isDirty,
      isDeleted: isDeleted ?? this.isDeleted,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
    );
  }
}
