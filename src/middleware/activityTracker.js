/**
 * Activity Tracker Middleware
 * 
 * Automatically tracks student activity by observing which API endpoints they hit.
 * This works WITHOUT any changes to the mobile app — it just watches API calls.
 * 
 * Usage: Add this middleware to routes that students use.
 * It updates the student_activity table based on the route being accessed.
 */
const StudentActivity = require('../models/StudentActivity');

// Map of URL patterns to activity types
const ACTIVITY_PATTERNS = [
    { pattern: /\/practice|\/quiz|\/game/i, field: 'last_practice' },
    { pattern: /\/vocab|\/word/i, field: 'last_vocab_practice' },
    { pattern: /\/feedback.*view|\/lesson.*feedback/i, field: 'last_feedback_viewed' },
    { pattern: /\/game|\/memory/i, field: 'last_game_played' },
];

/**
 * Middleware that tracks student activity on every API request.
 * 
 * Uses res.on('finish') pattern so it can be applied BEFORE auth middleware
 * at the router level. The actual tracking runs after the full request pipeline
 * completes, by which time req.userId is set by verify-token.
 * 
 * Non-blocking — tracking errors never affect the response.
 */
const activityTracker = (req, res, next) => {
    // Hook into response finish — this fires AFTER the entire middleware chain
    // including auth, controller, etc. By this point req.userId is set.
    res.on('finish', () => {
        // Only track successful responses from authenticated users
        if (!req.userId || res.statusCode >= 400) {
            return;
        }

        setImmediate(async () => {
            try {
                const userId = req.userId;
                const url = req.originalUrl || req.url;

                // Always update last_app_open
                const updateData = {
                    last_app_open: new Date(),
                    updated_at: new Date()
                };

                // Check if the URL matches any specific activity pattern
                for (const { pattern, field } of ACTIVITY_PATTERNS) {
                    if (pattern.test(url)) {
                        updateData[field] = new Date();
                    }
                }

                // Upsert — create if doesn't exist, update if exists
                const [activity, created] = await StudentActivity.findOrCreate({
                    where: { student_id: userId },
                    defaults: {
                        student_id: userId,
                        ...updateData
                    }
                });

                if (!created) {
                    await activity.update(updateData);
                }
            } catch (error) {
                // Silently fail — activity tracking should never break the main flow
                console.error('[ActivityTracker] Error:', error.message);
            }
        });
    });

    // Proceed immediately — tracking happens later via the finish event
    next();
};

/**
 * Explicit activity logging functions for use in controllers
 * Call these directly when you want to log a specific activity type
 */
const trackFeedbackViewed = async (studentId) => {
    try {
        await StudentActivity.upsert({
            student_id: studentId,
            last_feedback_viewed: new Date(),
            last_app_open: new Date(),
            updated_at: new Date()
        });
    } catch (error) {
        console.error('[ActivityTracker] trackFeedbackViewed error:', error.message);
    }
};

const trackPracticeCompleted = async (studentId) => {
    try {
        await StudentActivity.upsert({
            student_id: studentId,
            last_practice: new Date(),
            last_app_open: new Date(),
            updated_at: new Date()
        });
    } catch (error) {
        console.error('[ActivityTracker] trackPracticeCompleted error:', error.message);
    }
};

const trackVocabPractice = async (studentId) => {
    try {
        await StudentActivity.upsert({
            student_id: studentId,
            last_vocab_practice: new Date(),
            last_app_open: new Date(),
            updated_at: new Date()
        });
    } catch (error) {
        console.error('[ActivityTracker] trackVocabPractice error:', error.message);
    }
};

const trackGamePlayed = async (studentId) => {
    try {
        await StudentActivity.upsert({
            student_id: studentId,
            last_game_played: new Date(),
            last_app_open: new Date(),
            updated_at: new Date()
        });
    } catch (error) {
        console.error('[ActivityTracker] trackGamePlayed error:', error.message);
    }
};

module.exports = {
    activityTracker,
    trackFeedbackViewed,
    trackPracticeCompleted,
    trackVocabPractice,
    trackGamePlayed
};
