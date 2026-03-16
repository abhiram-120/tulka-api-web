const Joi = require('joi');

// require and configure dotenv, will load vars in .env in PROCESS.ENV
require('dotenv').config();

// define validation for all the env vars
const envVarsSchema = Joi.object({
    NODE_ENV: Joi.string()
        // .allow(['development', 'production', 'test', 'provision'])
        .default('development'),
    PORT: Joi.number().default(8080),
    JWT_SECRET_KEY: Joi.string().required().description('JWT Secret required to sign'),

    // database connection information
    HOST: Joi.string(),
    USER: Joi.string(),
    PASSWORD: Joi.string(),
    DATABASE: Joi.string().required().description('Database URL required'),

    // send email information
    // USER_EMAIL: Joi.string(),
    // EMAIL_PASS: Joi.string(),
    // EMAIL_HOST: Joi.string(),
    // EMAIL_SERVICE: Joi.string(),
    // DEVICE_TOKEN: Joi.string(),
    
    // Mailgun HTTP API configuration
    MAIL_MAILER: Joi.string(),
    MAILGUN_DOMAIN: Joi.string().required().description('Mailgun domain required'),
    MAILGUN_SECRET: Joi.string().required().description('Mailgun API secret required'),
    MAILGUN_ENDPOINT: Joi.string(),
    USER_EMAIL: Joi.string(),


    AWS_BUCKET: Joi.string(),
    AWS_ACCESS_KEY_ID: Joi.string(),
    AWS_SECRET_ACCESS_KEY: Joi.string(),

    TWILIO_SID: Joi.string(),
    TWILIO_AUTH_TOKEN: Joi.string(),
    TWILIO_NUMBER: Joi.string(),
    TWILIO_WHATSAPP_FROM: Joi.string(),

    AISENSY_API_KEY: Joi.string(),

})
    .unknown()
    .required();

const { error, value: envVars } = envVarsSchema.validate(process.env);
//if (error) {
  //  throw new Error(`Config validation error: ${error}`);
//}

const config = {
    env: envVars.NODE_ENV,
    port: envVars.PORT,
    jwtSecret: envVars.JWT_SECRET_KEY,

    // database connection information
    host: envVars.HOST,
    user: envVars.USER,
    password: envVars.PASSWORD,
    database: envVars.DATABASE,

    // send email information
    // email_user: envVars.USER_EMAIL,
    // email_service: envVars.SERVICE,
    // email_pass: envVars.EMAIL_PASS,
    // email_host: envVars.EMAIL_HOST,
    // device_token: envVars.DEVICE_TOKEN,
    
    // Mailgun HTTP API configuration
    mail_mailer: envVars.MAIL_MAILER,
    mailgun_domain: envVars.MAILGUN_DOMAIN,
    mailgun_secret: envVars.MAILGUN_SECRET,
    mailgun_endpoint: envVars.MAILGUN_ENDPOINT,
    email_user: envVars.USER_EMAIL,

    AWS_BUCKET: envVars.AWS_BUCKET,
    AWS_ACCESS_KEY_ID: envVars.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: envVars.AWS_SECRET_ACCESS_KEY,

    TWILIO_SID: envVars.TWILIO_SID,
    TWILIO_AUTH_TOKEN: envVars.TWILIO_AUTH_TOKEN,
    TWILIO_NUMBER: envVars.TWILIO_NUMBER,
    TWILIO_WHATSAPP_FROM: envVars.TWILIO_WHATSAPP_FROM,

    AISENSY_API_KEY: envVars.AISENSY_API_KEY,

    APP_URL: 'https://tulkka.com',

};

module.exports = config;
