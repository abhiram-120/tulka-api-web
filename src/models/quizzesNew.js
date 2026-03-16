const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const QuizzesNew = sequelize.define('Quiz', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    lesson_id: {
        type: DataTypes.INTEGER,
        defaultValue: null,
    },
    student_id: {
        type: DataTypes.INTEGER,
        defaultValue: null,
    },
    teacher_id: {
        type: DataTypes.INTEGER,
        defaultValue: null,
    },
    student_answers: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
    },
    answer_attachment: {
        type: DataTypes.STRING(255),
        defaultValue: null,
    },
    title: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING(255),
        defaultValue: null,
    },
    result: {
        type: DataTypes.STRING(250),
        defaultValue: null,
    },
    description: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: null,
    },
    teacher_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    attachment: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    quiz_test_image_1: {
        type: DataTypes.STRING(210),
        defaultValue: null,
    },
    quiz_test_image_2: {
        type: DataTypes.STRING(210),
        defaultValue: null,
    },
    quiz_test_image_correct: {
        type: DataTypes.BOOLEAN,
        defaultValue: null,
    },
    mcq_question: {
        type: DataTypes.STRING(210),
        defaultValue: null,
    },
    mcq_options: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    mcq_right_ans: {
        type: DataTypes.BOOLEAN,
        defaultValue: null,
    },
    student_quiz_test_image_answer: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    quiz_type: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
    },
    student_mcq_right_answer: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
}, {
    tableName: 'quizzes_new',
    timestamps: false,
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
});

// Export the model
module.exports = QuizzesNew;
