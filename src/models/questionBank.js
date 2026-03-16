const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const QuestionBank = sequelize.define(
    'QuestionBank',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        question: {
            type: DataTypes.TEXT,
            allowNull: false,
            get() {
                const rawValue = this.getDataValue('question');
                
                if (rawValue && typeof rawValue === 'string' && 
                    (rawValue.startsWith('{') || rawValue.startsWith('['))) {
                    try {
                        return JSON.parse(rawValue);
                    } catch (e) {
                        return rawValue;
                    }
                }
                return rawValue;
            },
            set(value) {
                if (value && typeof value === 'object') {
                    this.setDataValue('question', JSON.stringify(value));
                } else {
                    this.setDataValue('question', value);
                }
            }
        },
        type: {
            type: DataTypes.ENUM('single-choice', 'multiple-choice', 'checkbox', 'yes-no', 'text'),
            allowNull: false
        },
        question_order: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            allowNull: false,
            comment: 'Display order for questions in mobile app'
        },
        options: {
            type: DataTypes.JSON,
            defaultValue: null,
            get() {
                const rawValue = this.getDataValue('options');
                
                if (rawValue && typeof rawValue === 'string') {
                    try {
                        return JSON.parse(rawValue);
                    } catch (e) {
                        return rawValue;
                    }
                }
                return rawValue;
            },
            set(value) {
                if (value && (typeof value === 'object' || Array.isArray(value))) {
                    this.setDataValue('options', JSON.stringify(value));
                } else {
                    this.setDataValue('options', value);
                }
            }
        },
        is_active: {
            type: DataTypes.TINYINT,
            defaultValue: 1
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            onUpdate: DataTypes.NOW
        }
    },
    {
        tableName: 'question_bank',
        timestamps: false,
        underscored: true,
        collate: 'utf8mb4_unicode_ci',
        hooks: {
            beforeCreate: (question) => {
                if (question.question && typeof question.question === 'object') {
                    question.question = JSON.stringify(question.question);
                }
                
                if (question.options && (typeof question.options === 'object' || Array.isArray(question.options))) {
                    question.options = JSON.stringify(question.options);
                }
            },
            beforeUpdate: (question) => {
                if (question.question && typeof question.question === 'object') {
                    question.question = JSON.stringify(question.question);
                }
                
                if (question.options && (typeof question.options === 'object' || Array.isArray(question.options))) {
                    question.options = JSON.stringify(question.options);
                }
            }
        }
    }
);

// Add instance method for multilingual support
QuestionBank.prototype.getLocalizedQuestion = function(language = 'en') {
    try {
        let questionValue = this.getDataValue('question');
        
        if (typeof questionValue === 'string') {
            try {
                questionValue = JSON.parse(questionValue);
            } catch (e) {
                return questionValue;
            }
        }
        
        if (questionValue && typeof questionValue === 'object' && !Array.isArray(questionValue)) {
            return questionValue[language] || questionValue.en || '';
        }
        
        return questionValue || '';
    } catch (e) {
        console.error('Error getting localized question:', e);
        return '';
    }
};

// Add instance method for getting localized options
QuestionBank.prototype.getLocalizedOptions = function(language = 'en') {
    try {
        let optionsValue = this.getDataValue('options');
        
        if (!optionsValue) return [];
        
        if (typeof optionsValue === 'string') {
            try {
                optionsValue = JSON.parse(optionsValue);
                
                if (typeof optionsValue === 'string') {
                    optionsValue = JSON.parse(optionsValue);
                }
            } catch (e) {
                console.error('Error parsing options JSON:', e);
                return [];
            }
        }
        
        if (!optionsValue) return [];
        
        if (Array.isArray(optionsValue)) {
            return optionsValue;
        }
        
        if (typeof optionsValue === 'object') {
            const cleanOptions = (options) => {
                if (Array.isArray(options)) {
                    return options.map(option => 
                        typeof option === 'string' ? option.replace(/\\t/g, '').trim() : option
                    );
                }
                return options;
            };
            
            const languageOptions = optionsValue[language] || optionsValue.en || [];
            return cleanOptions(languageOptions);
        }
        
        return [];
    } catch (e) {
        console.error('Error getting localized options:', e);
        return [];
    }
};

module.exports = QuestionBank;