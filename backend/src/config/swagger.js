const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Google Maps Nigeria API',
      version: '1.0.0',
      description: 'Backend API for Google Maps Nigeria App'
    },
    servers: [
      { url: process.env.API_URL || 'http://localhost:3000', description: process.env.NODE_ENV || 'development' }
    ]
  },
  apis: ['./src/routes/*.js']
};

const specs = swaggerJsdoc(options);

const docsAuth = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  const token = String(process.env.SWAGGER_DOCS_TOKEN || '').trim();
  if (!token) {
    return res.status(503).json({
      success: false,
      message: 'API docs are disabled: SWAGGER_DOCS_TOKEN is not configured.'
    });
  }

  const authHeader = String(req.get('authorization') || '');
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  const headerToken = String(req.get('x-docs-token') || '').trim();
  const providedToken = bearerToken || headerToken;

  if (!providedToken || providedToken !== token) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized docs access'
    });
  }

  return next();
};

exports.setupSwagger = (app) => {
  app.use('/api/docs', docsAuth, swaggerUi.serve, swaggerUi.setup(specs));
};
