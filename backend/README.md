# Google Maps Nigeria App - Backend API

## Architecture Overview

### Technology Stack
- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Database**: Google Firestore
- **Authentication**: JWT + Firebase Auth
- **Payment**: Paystack (Nigerian payment gateway)
- **Analytics**: Google Analytics + Custom tracking
- **Hosting**: Railway / Render / Heroku

### Features
1. User Management & Authentication
2. Saved Places Cloud Sync
3. Premium Subscriptions
4. Analytics & Usage Tracking
5. Admin Dashboard
6. Monetization (Ads, Premium, Business Listings)

## Database Schema

### Collections

#### users
```javascript
{
  _id: ObjectId,
  email: String,
  name: String,
  phone: String,
  authProvider: String, // 'email', 'google', 'facebook'
  authId: String,
  isPremium: Boolean,
  premiumExpiry: Date,
  createdAt: Date,
  lastLogin: Date,
  deviceInfo: {
    platform: String,
    version: String,
    deviceId: String
  },
  usage: {
    totalSearches: Number,
    totalNavigations: Number,
    totalDistance: Number
  }
}
```

#### saved_places
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  name: String,
  address: String,
  latitude: Number,
  longitude: Number,
  category: String,
  notes: String,
  photos: [String], // URLs
  isPublic: Boolean,
  createdAt: Date,
  updatedAt: Date,
  syncedAt: Date
}
```

#### subscriptions
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  plan: String, // 'monthly', 'yearly'
  status: String, // 'active', 'cancelled', 'expired'
  amount: Number,
  currency: String,
  startDate: Date,
  endDate: Date,
  paymentMethod: String,
  paystackReference: String,
  autoRenew: Boolean
}
```

#### business_listings
```javascript
{
  _id: ObjectId,
  businessName: String,
  category: String,
  location: {
    type: "Point",
    coordinates: [Number, Number]
  },
  address: String,
  phone: String,
  website: String,
  description: String,
  photos: [String],
  hours: Object,
  isPaid: Boolean,
  featured: Boolean,
  views: Number,
  clicks: Number,
  createdAt: Date
}
```

#### analytics_events
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  eventType: String, // 'search', 'navigation', 'place_save', 'ad_click'
  eventData: Object,
  timestamp: Date,
  sessionId: String,
  platform: String
}
```

## API Endpoints

### Authentication
- POST `/api/auth/register` - Register new user
- POST `/api/auth/login` - Login user
- POST `/api/auth/google` - Google OAuth
- POST `/api/auth/refresh` - Refresh JWT token
- POST `/api/auth/logout` - Logout user

### User Management
- GET `/api/users/profile` - Get user profile
- PUT `/api/users/profile` - Update profile
- DELETE `/api/users/account` - Delete account
- GET `/api/users/usage` - Get usage statistics

### Saved Places
- GET `/api/places` - Get all saved places
- POST `/api/places` - Create saved place
- PUT `/api/places/:id` - Update saved place
- DELETE `/api/places/:id` - Delete saved place
- POST `/api/places/sync` - Bulk sync places
- GET `/api/places/public` - Get public places

### Maps Proxy
- GET `/api/maps/geocode?address=<text>&country=NG` - Geocode search text
- GET `/api/maps/autocomplete?input=<text>&country=ng&types=geocode|establishment` - Place suggestions
- GET `/api/maps/directions?origin=<text>&destination=<text>&mode=driving&region=ng` - Route directions

### Subscriptions
- GET `/api/subscriptions/plans` - Get available plans
- POST `/api/subscriptions/subscribe` - Create subscription
- POST `/api/subscriptions/verify` - Verify payment
- POST `/api/subscriptions/cancel` - Cancel subscription
- GET `/api/subscriptions/status` - Check subscription status

### Business Listings
- GET `/api/businesses/search` - Search businesses
- GET `/api/businesses/:id` - Get business details
- POST `/api/businesses` - Create listing (admin)
- PUT `/api/businesses/:id` - Update listing
- POST `/api/businesses/:id/view` - Track view
- POST `/api/businesses/:id/click` - Track click

### Analytics
- POST `/api/analytics/event` - Track event
- GET `/api/analytics/dashboard` - Get analytics (admin)

### Admin
- GET `/api/admin/users` - List all users
- GET `/api/admin/stats` - Platform statistics
- POST `/api/admin/featured` - Set featured business
- DELETE `/api/admin/users/:id` - Delete user

## Monetization Strategy

### 1. Freemium Model

**Free Tier:**
- Basic navigation
- 10 saved places
- Standard map features
- Ads displayed

**Premium Tier (₦2,000/month or ₦20,000/year):**
- Unlimited saved places
- Ad-free experience
- Offline maps for all cities
- Priority support
- Advanced features:
  - Route optimization
  - Multi-stop routing
  - Traffic predictions
  - Speed camera alerts
  - Voice customization

### 2. In-App Advertising

**Ad Placements:**
- Banner ads on map screen (non-intrusive)
- Interstitial ads after navigation completion
- Native ads in search results
- Sponsored business listings

**Ad Networks:**
- Google AdMob (primary)
- Facebook Audience Network
- Local Nigerian ad networks

**Revenue Share:**
- 70% app owner
- 30% ad network

### 3. Business Listings

**Basic Listing (Free):**
- Business name and location
- Contact information
- Basic description

**Premium Listing (₦10,000/month):**
- Featured placement in search
- Multiple photos
- Detailed description
- Priority in nearby search
- Analytics dashboard
- Customer reviews

**Sponsored Ads (₦50,000/month):**
- Top of search results
- Map marker highlighting
- Push notifications to nearby users
- Banner placement

### 4. API Access

**Developer API (₦50,000/month):**
- Access to routing API
- Geocoding services
- Place search API
- 100,000 requests/month

**Enterprise API (Custom pricing):**
- Unlimited requests
- Dedicated support
- Custom integrations
- SLA guarantees

### 5. Data Insights

**Traffic Data Reports:**
- Sell anonymized traffic data to:
  - Government agencies
  - Urban planners
  - Real estate developers
  - Logistics companies

### 6. Partnerships

**Ride-Hailing Integration:**
- Commission from Uber/Bolt bookings
- 5-10% per ride booked through app

**Fuel Station Partnerships:**
- Promote partner stations
- Loyalty programs
- ₦5,000/month per station

**Restaurant/Hotel Bookings:**
- Integration with booking platforms
- Commission on reservations

## Revenue Projections

### Year 1 (Conservative)
- 10,000 active users
- 500 premium subscribers (₦1M/month)
- 50 business listings (₦500K/month)
- Ad revenue (₦300K/month)
- **Total: ₦1.8M/month (₦21.6M/year)**

### Year 2 (Growth)
- 50,000 active users
- 3,000 premium subscribers (₦6M/month)
- 200 business listings (₦2M/month)
- Ad revenue (₦1.5M/month)
- **Total: ₦9.5M/month (₦114M/year)**

### Year 3 (Scale)
- 200,000 active users
- 15,000 premium subscribers (₦30M/month)
- 500 business listings (₦5M/month)
- Ad revenue (₦5M/month)
- API & Data sales (₦2M/month)
- **Total: ₦42M/month (₦504M/year)**

## Cost Structure

### Infrastructure
- Server hosting: ₦50,000/month
- Database: ₦30,000/month
- CDN: ₦20,000/month
- Google Maps API: ₦100,000/month (at scale)
- **Total: ₦200,000/month**

### Operations
- Customer support: ₦150,000/month
- Marketing: ₦300,000/month
- Development: ₦500,000/month
- **Total: ₦950,000/month**

### Net Profit (Year 1)
- Revenue: ₦1.8M/month
- Costs: ₦1.15M/month
- **Profit: ₦650K/month (₦7.8M/year)**

## Security Measures

1. **Authentication**: JWT with refresh tokens
2. **Encryption**: HTTPS only, encrypted data at rest
3. **Rate Limiting**: Prevent API abuse
4. **Input Validation**: Sanitize all inputs
5. **CORS**: Restrict to app domains
6. **API Keys**: Rotate regularly
7. **Audit Logs**: Track all admin actions

## Compliance

1. **NDPR**: Nigerian Data Protection Regulation compliance
2. **GDPR**: For international users
3. **PCI DSS**: For payment processing
4. **Terms of Service**: Clear user agreements
5. **Privacy Policy**: Transparent data usage

## Deployment

### Environment Variables
```
NODE_ENV=production
PORT=3000
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
GOOGLE_MAPS_API_KEY=...
PAYSTACK_SECRET_KEY=...
PAYSTACK_PUBLIC_KEY=...
FIREBASE_CONFIG=...
ADMOB_APP_ID=...
```

### CI/CD Pipeline
1. GitHub Actions for automated testing
2. Deploy to Railway/Render on merge to main
3. Automated database backups
4. Health checks and monitoring

## Getting Started

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev
```

## API Documentation

Full API documentation available at `/api/docs` (Swagger UI)
