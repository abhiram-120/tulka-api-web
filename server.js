require("dotenv").config();
const config = require("./src/config/config");
const app = require("./app");

app.listen(config.port, "0.0.0.0", () => {
    console.log(`Server listening on the port no https://localhost:${config.port}`);
});