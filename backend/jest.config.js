module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/config/**',
    '!src/middleware/errorHandler.js',
    '!src/server.js',
    '!src/server-test.js',
    '!src/models/**',
    '!src/middleware/rateLimitMetrics.js'
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/test/'
  ],
  coverageThreshold: {
    global: {
      branches: 15,
      functions: 10,
      lines: 20,
      statements: 20
    },
    './src/routes/': {
      branches: 18,
      functions: 40,
      lines: 35,
      statements: 35
    },
    './src/utils/': {
      branches: 40,
      functions: 50,
      lines: 50,
      statements: 50
    }
  },
  testMatch: [
    '**/test/**/*.test.js'
  ],
  verbose: true
};
