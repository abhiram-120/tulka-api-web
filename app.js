const express = require("express");
const app = express();
const path = require("path");
require("dotenv").config();
const { connection } = require("./src/connection/connection");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger-output.json");

const isVercelRuntime = Boolean(process.env.VERCEL);
const shouldRunCronJobs =
    !isVercelRuntime &&
    String(process.env.ENABLE_CRONJOBS ?? "true").toLowerCase() === "true";

require("./src/models/users");
require("./src/models/classes");
require("./src/models/UserSubscriptionDetails");

const setupAssociations = require("./src/models/associations");
setupAssociations();

const fs = require("fs");
const storageRoot = process.env.STORAGE_ROOT
    ? process.env.STORAGE_ROOT
    : isVercelRuntime
        ? path.join("/tmp", "tulkka-storage")
        : path.join(__dirname, "src", "storage");
const avatarsPath = path.join(storageRoot, "avatars");
const tempPath = path.join(storageRoot, "temp");

[storageRoot, avatarsPath, tempPath].forEach((dir) => {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (error) {
        console.warn(`Storage directory setup skipped for ${dir}:`, error.message);
    }
});

if (shouldRunCronJobs) {
    require("./src/cronjobs/reminder");
    require("./src/cronjobs/teacherSalary");
    require("./src/cronjobs/setMonthlyClasses");
    require("./src/cronjobs/trialClassReminders");
    require("./src/cronjobs/regularClassReminders");
    require("./src/cronjobs/setClassStatuses");
    require("./src/cronjobs/subscriptionRenewal");
    require("./src/cronjobs/offlinePaymentProcessor");
    require("./src/cronjobs/bonusClassRefresh");
    require("./src/cronjobs/dunningProcessor");
    require("./src/cronjobs/dailyRiskCalculation");
    require("./src/cronjobs/recurringRiskCalculation");
    require("./src/cronjobs/riskProcess");
    require("./src/cronjobs/engagementReminders");
}

let isConnectionInitialized = false;
const initializeConnection = async () => {
    if (isConnectionInitialized) {
        return;
    }
    isConnectionInitialized = true;
    await connection();
};
initializeConnection();

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use("/storage", express.static(storageRoot));

app.get("/", (req, res) => {
    res.json({ message: "Tulkka backend V2" });
});

const apiRouter = require("./src/routes/index.routes");
app.use("/api", apiRouter);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

module.exports = app;