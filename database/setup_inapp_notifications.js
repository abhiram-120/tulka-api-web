/**
 * Run this script once to:
 * 1. Create the user_notifications table
 * 2. Update all 7 default rules to include "inapp" in their channels
 */
const { sequelize } = require('../src/connection/connection');

async function setup() {
    try {
        console.log('Connecting to database...');
        await sequelize.authenticate();
        console.log('Connected.\n');

        // 1. Create user_notifications table
        console.log('Creating user_notifications table...');
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS user_notifications (
                id              INT PRIMARY KEY AUTO_INCREMENT,
                user_id         INT NOT NULL,
                rule_id         INT DEFAULT NULL,
                type            VARCHAR(100) NOT NULL,
                title           VARCHAR(255) NOT NULL,
                body            TEXT,
                data            JSON DEFAULT NULL,
                is_read         BOOLEAN DEFAULT FALSE,
                read_at         DATETIME DEFAULT NULL,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_read (user_id, is_read),
                INDEX idx_user_created (user_id, created_at),
                INDEX idx_rule (rule_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('user_notifications table created (or already exists).\n');

        // 2. Update all 7 default rules to include "inapp" in channels
        console.log('Updating default rules to include "inapp" channel...');

        const [rules] = await sequelize.query('SELECT id, rule_name, channels FROM notification_rules');
        
        for (const rule of rules) {
            let channels;
            try {
                channels = typeof rule.channels === 'string' ? JSON.parse(rule.channels) : rule.channels;
            } catch (e) {
                channels = ['push'];
            }

            if (!channels.includes('inapp')) {
                channels.push('inapp');
                await sequelize.query(
                    `UPDATE notification_rules SET channels = ? WHERE id = ?`,
                    { replacements: [JSON.stringify(channels), rule.id] }
                );
                console.log(`  Rule ${rule.id} (${rule.rule_name}): ${JSON.stringify(channels)}`);
            } else {
                console.log(`  Rule ${rule.id} (${rule.rule_name}): already has inapp`);
            }
        }

        console.log('\nDone! All rules now include "inapp" channel.');
        console.log('\nUpdated rules:');
        const [updated] = await sequelize.query('SELECT id, rule_name, channels FROM notification_rules');
        for (const r of updated) {
            const ch = typeof r.channels === 'string' ? JSON.parse(r.channels) : r.channels;
            console.log(`  ${r.id}. ${r.rule_name}: [${ch.join(', ')}]`);
        }

        process.exit(0);
    } catch (error) {
        console.error('Setup failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

setup();
