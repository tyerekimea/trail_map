# Firestore Schema (Current)

This file documents the current backend collections used by `backend/src`.

## users

Collection: `users`

Primary fields:

- `email` (string, lowercase)
- `name` (string)
- `phone` (string|null)
- `password` (string, bcrypt hash)
- `authProvider` (string, default `email`)
- `authId` (string|null)
- `deviceInfo` (map)
- `usage.totalSearches` (number)
- `usage.totalNavigations` (number)
- `usage.totalDistance` (number)
- `lastLogin` (timestamp)
- `isActive` (boolean)
- `role` (string: `user` | `admin`)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

## places

Collection: `places`

Primary fields:

- `userId` (string, user document id)
- `clientId` (string, client-generated stable id)
- `name` (string)
- `address` (string)
- `location.latitude` (number)
- `location.longitude` (number)
- `category` (string)
- `notes` (string|null)
- `photos` (array<string>)
- `isPublic` (boolean)
- `syncedAt` (timestamp)
- `deletedAt` (timestamp|null)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

## businesses

Collection: `businesses`

Primary fields:

- `name` (string)
- `description` (string|null)
- `category` (string)
- `address` (string)
- `city` (string|null)
- `state` (string|null)
- `country` (string, default `Nigeria`)
- `location.latitude` (number)
- `location.longitude` (number)
- `phone` (string|null)
- `email` (string|null)
- `website` (string|null)
- `tags` (array<string>)
- `ownerId` (string)
- `isActive` (boolean)
- `isVerified` (boolean)
- `analytics.views` (number)
- `analytics.clicks` (number)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

## analyticsEvents

Collection: `analyticsEvents`

Primary fields:

- `userId` (string)
- `eventType` (string)
- `screen` (string|null)
- `action` (string|null)
- `label` (string|null)
- `value` (number)
- `metadata` (map)
- `entityType` (string|null)
- `entityId` (string|null)
- `platform` (string|null)
- `appVersion` (string|null)
- `ipAddress` (string)
- `userAgent` (string)
- `occurredAt` (timestamp)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

## refreshTokens

Collection: `refreshTokens`

Primary fields:

- `userId` (string)
- `tokenHash` (string, SHA-256 hash)
- `expiresAt` (timestamp)
- `revoked` (boolean)
- `revokedAt` (timestamp|null)
- `replacedBy` (string|null)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

## Notes

- Subscriptions were intentionally removed and are not part of the current backend.
- Firestore security rules should default-deny direct client access; backend uses Admin SDK.
