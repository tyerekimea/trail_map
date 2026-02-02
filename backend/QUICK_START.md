# Backend Quick Start Guide

## 🚀 Running the Backend Server

### Option 1: With MongoDB Atlas (Recommended - Free)

**Step 1: Create MongoDB Atlas Account**
```bash
# Visit: https://www.mongodb.com/cloud/atlas/register
# 1. Sign up for free
# 2. Create a free cluster (M0 Sandbox)
# 3. Create database user
# 4. Whitelist IP: 0.0.0.0/0 (allow from anywhere)
# 5. Get connection string
```

**Step 2: Update .env File**
```bash
cd /workspaces/mapbox_nigeria_app/backend

# Edit .env file
nano .env

# Replace this line:
MONGODB_URI=mongodb+srv://demo:demo@cluster0.mongodb.net/maps_nigeria

# With your actual connection string:
MONGODB_URI=mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/maps_nigeria?retryWrites=true&w=majority
```

**Step 3: Install Dependencies**
```bash
npm install
```

**Step 4: Start Server**
```bash
npm run dev
```

---

### Option 2: Without Database (API Only - For Testing)

If you just want to test the API without database:

**Step 1: Modify server.js to skip MongoDB**
```bash
cd /workspaces/mapbox_nigeria_app/backend
```

Create a test version:
```bash
cat > src/server-test.js << 'EOF'
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend API is running (without database)',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Test routes
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API is working!',
    features: [
      'GPS Navigation',
      'Offline Maps',
      'Saved Places',
      'Traffic Updates',
      'Voice Guidance'
    ]
  });
});

// Mock subscription plans
app.get('/api/subscriptions/plans', (req, res) => {
  res.json({
    success: true,
    data: [
      {
        id: 'monthly',
        name: 'Monthly Premium',
        price: 2000,
        currency: 'NGN',
        duration: '1 month',
        features: [
          'Unlimited saved places',
          'Ad-free experience',
          'Offline maps for all cities',
          'Priority support'
        ]
      },
      {
        id: 'yearly',
        name: 'Yearly Premium',
        price: 20000,
        currency: 'NGN',
        duration: '1 year',
        discount: '17%',
        features: [
          'All monthly features',
          'Save ₦4,000 per year',
          'Priority support',
          'Early access to new features'
        ]
      }
    ]
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('🚀 Backend API running on port', PORT);
  console.log('📚 Test endpoints:');
  console.log('   - http://localhost:' + PORT + '/health');
  console.log('   - http://localhost:' + PORT + '/api/test');
  console.log('   - http://localhost:' + PORT + '/api/subscriptions/plans');
  console.log('\n⚠️  Note: Running without database (test mode)');
});
EOF
```

**Step 2: Run Test Server**
```bash
node src/server-test.js
```

---

### Option 3: Using Docker with MongoDB

**Step 1: Start MongoDB with Docker**
```bash
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password123 \
  mongo:latest
```

**Step 2: Update .env**
```bash
MONGODB_URI=mongodb://admin:password123@localhost:27017/maps_nigeria?authSource=admin
```

**Step 3: Start Server**
```bash
npm run dev
```

---

## 📝 Current Status

Your backend is ready but needs a database connection. Choose one of the options above:

1. **MongoDB Atlas** (Recommended) - Free, cloud-hosted, no setup
2. **Test Mode** (Quick) - No database, just API testing
3. **Docker** (Advanced) - Local MongoDB instance

---

## 🔧 Troubleshooting

### Error: "MongoDB connection error"
**Solution**: Set up MongoDB Atlas or use test mode

### Error: "Cannot find module"
**Solution**: Run `npm install` in the backend directory

### Error: "Port 3000 already in use"
**Solution**: Change PORT in .env file or kill the process:
```bash
lsof -ti:3000 | xargs kill -9
```

### Error: "ENOENT: no such file or directory"
**Solution**: Make sure you're in the backend directory:
```bash
cd /workspaces/mapbox_nigeria_app/backend
```

---

## 🎯 Quick Commands

```bash
# Navigate to backend
cd /workspaces/mapbox_nigeria_app/backend

# Install dependencies
npm install

# Run development server (with MongoDB)
npm run dev

# Run test server (without MongoDB)
node src/server-test.js

# Run production server
npm start

# Check if server is running
curl http://localhost:3000/health
```

---

## 🌐 API Endpoints (Once Running)

### Health Check
```bash
GET http://localhost:3000/health
```

### Test Endpoint
```bash
GET http://localhost:3000/api/test
```

### Subscription Plans
```bash
GET http://localhost:3000/api/subscriptions/plans
```

### API Documentation
```bash
GET http://localhost:3000/api/docs
```

---

## 📱 Connecting Mobile App to Backend

Once your backend is running, update the Flutter app:

**File**: `lib/main.dart`

```dart
// Add at the top
const String API_URL = 'http://localhost:3000'; // For emulator
// const String API_URL = 'http://10.0.2.2:3000'; // For Android emulator
// const String API_URL = 'https://your-api.railway.app'; // For production

// Example API call
Future<void> fetchSubscriptionPlans() async {
  final response = await http.get(Uri.parse('$API_URL/api/subscriptions/plans'));
  if (response.statusCode == 200) {
    final data = json.decode(response.body);
    print('Plans: ${data['data']}');
  }
}
```

---

## 🚀 Deploy to Production

See `DEPLOYMENT.md` for detailed deployment instructions to:
- Railway (Recommended)
- Render
- Heroku

---

## 💡 Next Steps

1. **Set up MongoDB Atlas** (5 minutes)
   - Free forever
   - No credit card required
   - 512MB storage

2. **Start the backend**
   ```bash
   npm run dev
   ```

3. **Test the API**
   ```bash
   curl http://localhost:3000/health
   ```

4. **Connect mobile app**
   - Update API_URL in Flutter app
   - Test authentication
   - Test saved places sync

5. **Deploy to production**
   - Push to GitHub
   - Deploy on Railway
   - Update mobile app with production URL

---

## 📞 Need Help?

- **MongoDB Atlas Setup**: https://www.mongodb.com/docs/atlas/getting-started/
- **Backend Issues**: Check `backend/README.md`
- **Deployment**: Check `backend/DEPLOYMENT.md`
- **API Docs**: http://localhost:3000/api/docs (when running)

---

**Happy Coding! 🎉**
