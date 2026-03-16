const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const FillBlankQuestion = require('./fillBlankQuestion');

const FillBlankOption = sequelize.define('fill_blank_options', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    question_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'fill_blank_questions',
            key: 'id'
        }
    },
    option_text: {
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

// FillBlankOption.belongsTo(FillBlankQuestion, {
//     foreignKey: 'question_id',
//     as: 'Question',
//     onDelete: 'CASCADE'
// });

// FillBlankQuestion.hasMany(FillBlankOption, {
//     foreignKey: 'question_id',
//     as: 'Options',
//     onDelete: 'CASCADE'
// });

module.exports = FillBlankOption;