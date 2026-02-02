require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(morgan('dev'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend API is running (TEST MODE - No Database)',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '2.0.0'
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API is working!',
    features: [
      'GPS Navigation',
      'Offline Maps',
      'Saved Places',
      'Traffic Updates',
      'Voice Guidance',
      'Premium Subscriptions'
    ],
    note: 'This is a test server without database. For full functionality, set up MongoDB Atlas.'
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
          'Advanced route optimization',
          'Multi-stop routing',
          'Traffic predictions',
          'Speed camera alerts',
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
        savings: 4000,
        features: [
          'All monthly features',
          'Save ₦4,000 per year',
          'Priority support',
          'Early access to new features',
          'Exclusive beta features'
        ]
      }
    ]
  });
});

// Mock user registration
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body;
  
  if (!email || !password || !name) {
    return res.status(400).json({
      success: false,
      message: 'Email, password, and name are required'
    });
  }
  
  res.status(201).json({
    success: true,
    message: 'User registered successfully (TEST MODE)',
    data: {
      user: {
        id: 'test-user-' + Date.now(),
        email,
        name,
        isPremium: false,
        createdAt: new Date().toISOString()
      },
      token: 'test-jwt-token-' + Date.now(),
      refreshToken: 'test-refresh-token-' + Date.now()
    },
    note: 'This is a mock response. Set up MongoDB for real authentication.'
  });
});

// Mock user login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }
  
  res.json({
    success: true,
    message: 'Login successful (TEST MODE)',
    data: {
      user: {
        id: 'test-user-123',
        email,
        name: 'Test User',
        isPremium: false,
        lastLogin: new Date().toISOString()
      },
      token: 'test-jwt-token-' + Date.now(),
      refreshToken: 'test-refresh-token-' + Date.now()
    },
    note: 'This is a mock response. Set up MongoDB for real authentication.'
  });
});

// Mock saved places
app.get('/api/places', (req, res) => {
  res.json({
    success: true,
    count: 3,
    data: [
      {
        id: '1',
        name: 'Home',
        address: 'Victoria Island, Lagos',
        latitude: 6.4281,
        longitude: 3.4219,
        category: 'Home',
        createdAt: new Date().toISOString()
      },
      {
        id: '2',
        name: 'Office',
        address: 'Ikoyi, Lagos',
        latitude: 6.4541,
        longitude: 3.4316,
        category: 'Work',
        createdAt: new Date().toISOString()
      },
      {
        id: '3',
        name: 'Favorite Restaurant',
        address: 'Lekki Phase 1, Lagos',
        latitude: 6.4474,
        longitude: 3.4700,
        category: 'Restaurant',
        createdAt: new Date().toISOString()
      }
    ],
    note: 'Mock data. Set up MongoDB to save real places.'
  });
});

// Mock create place
app.post('/api/places', (req, res) => {
  const { name, address, latitude, longitude, category } = req.body;
  
  res.status(201).json({
    success: true,
    message: 'Place saved (TEST MODE)',
    data: {
      id: 'place-' + Date.now(),
      name,
      address,
      latitude,
      longitude,
      category,
      createdAt: new Date().toISOString()
    },
    note: 'Mock response. Set up MongoDB to persist data.'
  });
});

// API documentation
app.get('/api/docs', (req, res) => {
  res.json({
    success: true,
    message: 'API Documentation',
    version: '2.0.0',
    baseUrl: `http://localhost:${PORT}`,
    endpoints: {
      health: {
        method: 'GET',
        path: '/health',
        description: 'Check server health'
      },
      test: {
        method: 'GET',
        path: '/api/test',
        description: 'Test API connection'
      },
      subscriptionPlans: {
        method: 'GET',
        path: '/api/subscriptions/plans',
        description: 'Get available subscription plans'
      },
      register: {
        method: 'POST',
        path: '/api/auth/register',
        description: 'Register new user',
        body: { email: 'string', password: 'string', name: 'string' }
      },
      login: {
        method: 'POST',
        path: '/api/auth/login',
        description: 'Login user',
        body: { email: 'string', password: 'string' }
      },
      places: {
        method: 'GET',
        path: '/api/places',
        description: 'Get saved places'
      },
      createPlace: {
        method: 'POST',
        path: '/api/places',
        description: 'Create saved place',
        body: {
          name: 'string',
          address: 'string',
          latitude: 'number',
          longitude: 'number',
          category: 'string'
        }
      }
    },
    note: 'This is a TEST server without database. For full functionality, set up MongoDB Atlas and use npm run dev'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    availableEndpoints: [
      'GET /health',
      'GET /api/test',
      'GET /api/docs',
      'GET /api/subscriptions/plans',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/places',
      'POST /api/places'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n🚀 ========================================');
  console.log('   Backend API Server (TEST MODE)');
  console.log('========================================\n');
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Base URL: http://localhost:${PORT}\n`);
  console.log('📚 Available Endpoints:');
  console.log(`   - http://localhost:${PORT}/health`);
  console.log(`   - http://localhost:${PORT}/api/test`);
  console.log(`   - http://localhost:${PORT}/api/docs`);
  console.log(`   - http://localhost:${PORT}/api/subscriptions/plans`);
  console.log(`   - http://localhost:${PORT}/api/auth/register (POST)`);
  console.log(`   - http://localhost:${PORT}/api/auth/login (POST)`);
  console.log(`   - http://localhost:${PORT}/api/places (GET/POST)`);
  console.log('\n⚠️  Note: Running in TEST MODE without database');
  console.log('   For full functionality, set up MongoDB Atlas:');
  console.log('   1. Visit https://www.mongodb.com/cloud/atlas');
  console.log('   2. Create free cluster');
  console.log('   3. Update MONGODB_URI in .env');
  console.log('   4. Run: npm run dev\n');
  console.log('📖 See QUICK_START.md for detailed setup\n');
  console.log('========================================\n');
});

module.exports = app;
