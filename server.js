const express = require("express");
const app = express();
const path = require("path"); // Added path module import
require("dotenv").config();
const config = require('./src/config/config');
const { connection } = require("./src/connection/connection");
const bodyParser = require("body-parser");
const morgan = require('morgan')
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger-output.json');

//import cronjobs
require('./src/cronjobs/reminder');
require('./src/models/users');
require('./src/models/classes');
require('./src/models/UserSubscriptionDetails');

const setupAssociations = require('./src/models/associations');
setupAssociations();

// Create storage directories if they don't exist
const fs = require('fs');
const storagePath = path.join(__dirname, 'src', 'storage');
const avatarsPath = path.join(storagePath, 'avatars');
const tempPath = path.join(storagePath, 'temp');

[storagePath, avatarsPath, tempPath].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});
require('./src/cronjobs/teacherSalary');
require('./src/cronjobs/setMonthlyClasses');
require('./src/cronjobs/trialClassReminders');
require('./src/cronjobs/regularClassReminders');
require('./src/cronjobs/setClassStatuses');
require('./src/cronjobs/subscriptionRenewal');
require('./src/cronjobs/offlinePaymentProcessor');
require('./src/cronjobs/bonusClassRefresh');
require('./src/cronjobs/dunningProcessor');
require('./src/cronjobs/dailyRiskCalculation');
require('./src/cronjobs/recurringRiskCalculation');
require('./src/cronjobs/riskProcess');
require('./src/cronjobs/engagementReminders');

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));


// Serve static files from storage directory
app.use('/storage', express.static(path.join(__dirname, 'src', 'storage')));

// connection
connection();

// home api
app.get("/", (req, res) => {
    res.json({ message: 'Tulkka backend V2' })
});

// Routes
const apiRouter = require("./src/routes/index.routes");

// api initial path
app.use("/api", apiRouter);

// Swagger Documentation Path
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Server listening
app.listen(config.port, '0.0.0.0', () => {
    console.log(`Server listening on the port no https://localhost:${config.port}`);
});