const Users = require("../models/users");
const { Op, Sequelize } = require('sequelize');
const UserSubscriptionDetails = require("../models/UserSubscriptionDetails");
const Quizzes = require("../models/quizzesNew");

// Register new student
async function viewPoint(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        // Check if user exists
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let quizzes = await Quizzes.findAll({ where: { student_id: user.id } });

        // Filter out quizzes where result is null
        const validQuizzes = quizzes.filter(quiz => quiz.result !== null);

        let subscriptionDetails = await UserSubscriptionDetails.findOne({
            attributes: ["lesson_min"],
            where: {
                user_id: user.id
            },
            order: [['created_at', 'DESC']],
            limit: 1,
        });

        let quizResults = [];
        let overallTotalPoints = 0;
        let overallAssessmentGrade = 0;
        let classDuration;

        validQuizzes.forEach(quiz => {
            let totalPoints = 0;
            let assessmentGrade = 0;
            const quizResult = quiz.result;

            if (subscriptionDetails.lesson_min == 25) {
                totalPoints = Math.floor((4 / 10) * quizResult);
                assessmentGrade = (quizResult / 10) * 100;
                classDuration = 10;
            } else if (subscriptionDetails.lesson_min == 40) {
                totalPoints = Math.floor((5 / 15) * quizResult);
                assessmentGrade = (quizResult / 15) * 100;
                classDuration = 15;
            } else if (subscriptionDetails.lesson_min == 55) {
                totalPoints = Math.floor((7 / 20) * quizResult);
                assessmentGrade = (quizResult / 20) * 100;
                classDuration = 20;
            }

            totalPoints = totalPoints || 0;
            assessmentGrade = assessmentGrade || 0;

            assessmentGrade = assessmentGrade.toFixed(2);

            quizResults.push({
                quizId: quiz.id,
                type: quiz.quiz_type,
                date: quiz.created_at,
                title: quiz.title,
                result: quiz.result,
                totalPoints,
                assessmentGrade: `${assessmentGrade}%`,
            });

            overallTotalPoints += totalPoints;
            overallAssessmentGrade += parseFloat(assessmentGrade);
        });
        overallAssessmentGrade = overallAssessmentGrade.toFixed(2);

        /********* LEVEL ********/
        let currentLevels = "Pre - Basic User(Pre - A1)";
        let nextLevels = "Basic User 1 (A1)";

        if (overallTotalPoints > 100 && overallTotalPoints <= 200) {
            currentLevels = "Basic User 1 (A1)";
            nextLevels = "High Basic User 1 (A1)";
        } else if (overallTotalPoints > 200 && overallTotalPoints <= 300) {
            currentLevels = "High Basic User 1 (A1)";
            nextLevels = "Low Basic User 2 (A2)";
        } else if (overallTotalPoints > 300 && overallTotalPoints <= 400) {
            currentLevels = "Low Basic User 2 (A2)";
            nextLevels = "Basic User 2 (A2)";
        } else if (overallTotalPoints > 400 && overallTotalPoints <= 500) {
            currentLevels = "Basic User 2 (A2)";
            nextLevels = "High Basic User 2 (A2)";
        } else if (overallTotalPoints > 500 && overallTotalPoints <= 600) {
            currentLevels = "High Basic User 2 (A2)";
            nextLevels = "Low Independent User 1 (B1)";
        } else if (overallTotalPoints > 600 && overallTotalPoints <= 700) {
            currentLevels = "Low Independent User 1 (B1)";
            nextLevels = "Independent User 1 (B1)";
        } else if (overallTotalPoints > 700 && overallTotalPoints <= 800) {
            currentLevels = "Independent User 1 (B1)";
            nextLevels = "High Independent User 1 (B1)";
        } else if (overallTotalPoints > 800 && overallTotalPoints <= 900) {
            currentLevels = "High Independent User 1 (B1)";
            nextLevels = "Low Independent User 2 (B2)";
        } else if (overallTotalPoints > 900 && overallTotalPoints <= 1000) {
            currentLevels = "Low Independent User 2 (B2)";
            nextLevels = "Independent User 2 (B2)";
        } else if (overallTotalPoints > 1000 && overallTotalPoints <= 1100) {
            currentLevels = "Independent User 2 (B2)";
            nextLevels = "High Independent User 2 (B2)";
        } else if (overallTotalPoints > 1100 && overallTotalPoints <= 1200) {
            currentLevels = "High Independent User 2 (B2)";
            nextLevels = "Advanced (C1)";
        } else if (overallTotalPoints > 1200 && overallTotalPoints <= 1300) {
            currentLevels = "Advanced (C1)";
            nextLevels = "Superior Advanced (C1)";
        } else if (overallTotalPoints > 1300 && overallTotalPoints <= 1400) {
            currentLevels = "Superior Advanced (C1)";
            nextLevels = "Highly Advanced (C1)";
        } else if (overallTotalPoints > 1400) {
            currentLevels = "Highly Advanced (C1)";
            nextLevels = "-";
        }


        let lesson_min = subscriptionDetails.lesson_min;

        subscriptionDetails = {
            lesson_min,
            classDuration
        }
        return res.status(200).json({
            status: 'success',
            message: 'Quiz-wise and overall total points and assessment grade',
            overallTotalPoints,
            currentLevels,
            nextLevels,
            // overallAssessmentGrade: `${overallAssessmentGrade}%`,
            subscriptionDetails,
            quizResults,
        });

    } catch (err) {
        return res.status(500).json({
            status: "error",
            message: err.message,
        });
    }
}

module.exports = {
    viewPoint
}