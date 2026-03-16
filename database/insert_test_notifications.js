const UserNotification = require('../src/models/UserNotification');
const { sequelize } = require('../src/connection/connection');

async function insertTestNotifications() {
    await sequelize.authenticate();
    console.log('DB connected');

    const n1 = await UserNotification.create({
        user_id: 1,
        rule_id: 3,
        type: 'inactivity',
        title: 'We miss you! 💙',
        body: 'You haven\'t opened the app in a while. Come practice!',
        data: JSON.stringify({ rule_name: 'inactivity_gentle', trigger_type: 'inactivity', priority: 3 }),
        is_read: false,
        created_at: new Date()
    });
    console.log('Created notification id:', n1.id);

    const n2 = await UserNotification.create({
        user_id: 1,
        rule_id: 1,
        type: 'post_lesson_feedback',
        title: 'Your teacher left feedback! 📝',
        body: 'After your last lesson, your teacher wrote you feedback. Check it out!',
        data: JSON.stringify({ rule_name: 'post_lesson_feedback', trigger_type: 'post_lesson_feedback', priority: 1 }),
        is_read: false,
        created_at: new Date()
    });
    console.log('Created notification id:', n2.id);

    console.log('Done! 2 test notifications created for user 1.');
    process.exit(0);
}

insertTestNotifications().catch(e => { console.error(e); process.exit(1); });
