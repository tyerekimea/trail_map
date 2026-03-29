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

exports.setupSwagger = (app) => {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(specs));
};
