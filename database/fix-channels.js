/**
 * Fix channels JSON data and verify seed
 * Run with: node database/fix-channels.js
 */
const { sequelize } = require('../src/connection/connection');
const NotificationRule = require('../src/models/NotificationRule');

async function fix() {
    try {
        await sequelize.authenticate();
        console.log('DB connected');

        // Fix channels using raw SQL
        await sequelize.query(
            `UPDATE notification_rules SET channels = '["push", "whatsapp"]' WHERE rule_name IN ('post_lesson_feedback', 'inactivity_urgent')`
        );
        await sequelize.query(
            `UPDATE notification_rules SET channels = '["push"]' WHERE rule_name NOT IN ('post_lesson_feedback', 'inactivity_urgent')`
        );

        console.log('Channels fixed!');

        // Verify
        const rules = await NotificationRule.findAll({ raw: true });
        for (const r of rules) {
            console.log(`  ${r.rule_name}: channels = ${JSON.stringify(r.channels)}, active = ${r.is_active}`);
        }

        console.log(`\nTotal rules: ${rules.length}`);
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

fix();
