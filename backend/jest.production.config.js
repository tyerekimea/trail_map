const baseConfig = require('./jest.config');

module.exports = {
  ...baseConfig,
  coverageThreshold: {
    global: {
      branches: 15,
      functions: 10,
      lines: 20,
      statements: 20
    },
    './src/routes/': {
      branches: 22,
      functions: 45,
      lines: 40,
      statements: 40
    },
    './src/utils/': {
      branches: 50,
      functions: 65,
      lines: 58,
      statements: 58
    }
  }
};
