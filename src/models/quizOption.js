const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const QuizQuestion = require('./quizQuestion');

const QuizOption = sequelize.define('quiz_options', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    question_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'quiz_questions',
            key: 'id'
        }
    },
    text: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    is_correct: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: false
});

// QuizOption.belongsTo(QuizQuestion, {
//     foreignKey: 'question_id',
//     as: 'Question',
//     onDelete: 'CASCADE'
// });

// QuizQuestion.hasMany(QuizOption, {
//     foreignKey: 'question_id',
//     as: 'Options',
//     onDelete: 'CASCADE'
// });

module.exports = QuizOption;