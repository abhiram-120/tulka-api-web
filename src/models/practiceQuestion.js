const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const PracticeSession = require('./practiceSession');

const PracticeQuestion = sequelize.define('practice_questions', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    session_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'practice_sessions',
            key: 'id'
        }
    },
    question_type: {
        type: DataTypes.ENUM('quiz', 'fill_blank'),
        allowNull: false
    },
    question_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    user_answer: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    is_correct: {
        type: DataTypes.BOOLEAN,
        allowNull: true
    },
    time_taken: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Seconds taken to answer'
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: false,
    tableName: 'practice_questions'
});

// PracticeQuestion.belongsTo(PracticeSession, {
//     foreignKey: 'session_id',
//     as: 'Session',
//     onDelete: 'CASCADE'
// });

// PracticeSession.hasMany(PracticeQuestion, {
//     foreignKey: 'session_id',
//     as: 'Questions',
//     onDelete: 'CASCADE'
// });

module.exports = PracticeQuestion;