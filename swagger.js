const swaggerAutogen = require('swagger-autogen')();

const doc = {
    info: {
        title: 'Tulkka',
        description: 'This is API documentation of Tulkka Project',
    },
    host: '18.197.42.247:8000/api',
    // host: 'localhost:6060/api',
    securityDefinitions: {
        ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'Authorization',
        },
    },
    security: [
        {
            ApiKeyAuth: [],
        },
    ],
};

const outputFile = './swagger-output.json';
const routes = ['./src/routes/index.routes.js'];

swaggerAutogen(outputFile, routes, doc);
