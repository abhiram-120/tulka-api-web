// models/userTeacherRecommendation.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const crypto = require('crypto');

const UserTeacherRecommendation = sequelize.define(
    'UserTeacherRecommendation',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        recommendation_data: {
            type: DataTypes.JSON,
            allowNull: false,
            comment: 'Complete recommendation response with topThreeTeachers, otherMatchedTeachers, unrankedTeachers',
            get() {
                const rawValue = this.getDataValue('recommendation_data');
                
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
                if (value && typeof value === 'object') {
                    this.setDataValue('recommendation_data', JSON.stringify(value));
                } else {
                    this.setDataValue('recommendation_data', value);
                }
            }
        },
        student_responses_hash: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'MD5 hash of student responses to detect changes'
        },
        total_teachers_count: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: 0,
            comment: 'Total number of teachers available when generated'
        },
        selected_teachers_count: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: 6,
            comment: 'Number of teachers sent to AI for ranking'
        },
        ai_provider: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'AI provider used: DeepSeek, OpenAI, or Fallback'
        },
        ai_status: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Generation status: success, fallback, error, no_teachers'
        },
        created_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000),
            comment: 'Unix timestamp of creation'
        },
        updated_at: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Unix timestamp of last update'
        },
        expires_at: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Unix timestamp when cache expires (7 days default)'
        },
        deleted_at: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Unix timestamp of soft delete'
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'Whether recommendation is still valid'
        }
    },
    {
        tableName: 'user_teacher_recommendations',
        timestamps: false,
        underscored: true,
        collate: 'utf8mb4_unicode_ci',
        indexes: [
            {
                fields: ['user_id', 'is_active']
            },
            {
                fields: ['user_id', 'student_responses_hash']
            },
            {
                fields: ['student_responses_hash']
            },
            {
                fields: ['created_at']
            },
            {
                fields: ['expires_at']
            },
            {
                fields: ['is_active']
            }
        ],
        hooks: {
            beforeCreate: (recommendation) => {
                if (recommendation.recommendation_data && typeof recommendation.recommendation_data === 'object') {
                    recommendation.recommendation_data = JSON.stringify(recommendation.recommendation_data);
                }
                
                // Set expires_at to 7 days from now if not set
                if (!recommendation.expires_at) {
                    recommendation.expires_at = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days
                }
                
                // Set updated_at
                recommendation.updated_at = Math.floor(Date.now() / 1000);
            },
            beforeUpdate: (recommendation) => {
                if (recommendation.recommendation_data && typeof recommendation.recommendation_data === 'object') {
                    recommendation.recommendation_data = JSON.stringify(recommendation.recommendation_data);
                }
                
                // Update updated_at timestamp
                recommendation.updated_at = Math.floor(Date.now() / 1000);
            }
        }
    }
);

// Static method to generate hash from student responses
UserTeacherRecommendation.generateResponsesHash = function(studentResponses) {
    // Create a consistent string from responses for hashing
    const responseString = studentResponses
        .sort((a, b) => a.questionId - b.questionId) // Sort by question ID for consistency
        .map(response => {
            return `${response.questionId}:${response.responseText || ''}:${JSON.stringify(response.selectedOptions || [])}`;
        })
        .join('|');
    
    return crypto.createHash('md5').update(responseString).digest('hex');
};

// Static method to check if recommendation exists and is valid
UserTeacherRecommendation.findValidRecommendation = async function(userId, studentResponses) {
    const responsesHash = this.generateResponsesHash(studentResponses);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    
    const recommendation = await this.findOne({
        where: {
            user_id: userId,
            student_responses_hash: responsesHash,
            is_active: true,
            deleted_at: null
        },
        order: [['created_at', 'DESC']]
    });
    
    // Check if recommendation is expired
    if (recommendation && recommendation.expires_at && currentTimestamp > recommendation.expires_at) {
        await recommendation.update({ 
            is_active: false,
            updated_at: currentTimestamp
        });
        return null;
    }
    
    return recommendation;
};

// Instance method to check if recommendation is still valid
UserTeacherRecommendation.prototype.isValid = function() {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    
    if (!this.is_active) return false;
    if (this.deleted_at) return false;
    if (this.expires_at && currentTimestamp > this.expires_at) return false;
    
    return true;
};

// Static method to create or update recommendation
UserTeacherRecommendation.createRecommendation = async function(userId, studentResponses, recommendationData, metadata = {}) {
    const responsesHash = this.generateResponsesHash(studentResponses);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const expiresAt = currentTimestamp + (7 * 24 * 60 * 60); // 7 days from now
    
    // Deactivate any existing recommendations for this user
    await this.update(
        { 
            is_active: false,
            updated_at: currentTimestamp
        },
        { 
            where: { 
                user_id: userId,
                is_active: true,
                deleted_at: null
            } 
        }
    );
    
    // Create new recommendation
    return await this.create({
        user_id: userId,
        recommendation_data: recommendationData,
        student_responses_hash: responsesHash,
        total_teachers_count: metadata.totalTeachers || 0,
        selected_teachers_count: metadata.selectedTeachers || 6,
        ai_provider: metadata.provider || null,
        ai_status: metadata.status || null,
        expires_at: expiresAt,
        created_at: currentTimestamp,
        updated_at: currentTimestamp
    });
};

// Static method to clean up expired recommendations
UserTeacherRecommendation.cleanupExpired = async function() {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    
    const [affectedRows] = await this.update(
        { 
            is_active: false,
            updated_at: currentTimestamp
        },
        { 
            where: { 
                expires_at: { [require('sequelize').Op.lt]: currentTimestamp },
                is_active: true,
                deleted_at: null
            } 
        }
    );
    
    return affectedRows;
};

// Static method to soft delete user's recommendations
UserTeacherRecommendation.softDeleteUserRecommendations = async function(userId) {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    
    const [affectedRows] = await this.update(
        { 
            is_active: false,
            deleted_at: currentTimestamp,
            updated_at: currentTimestamp
        },
        { 
            where: { 
                user_id: userId,
                is_active: true,
                deleted_at: null
            } 
        }
    );
    
    return affectedRows;
};

// Static method to get cache statistics
UserTeacherRecommendation.getCacheStats = async function(days = 7) {
    const { Op } = require('sequelize');
    const startTimestamp = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
    
    const stats = await this.findAll({
        attributes: [
            [sequelize.fn('COUNT', sequelize.col('id')), 'total_recommendations'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN is_active = 1 THEN 1 END')), 'active_recommendations'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN expires_at < UNIX_TIMESTAMP() THEN 1 END')), 'expired_recommendations'],
            [sequelize.fn('AVG', sequelize.col('total_teachers_count')), 'avg_teachers_count'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN ai_provider = "DeepSeek" THEN 1 END')), 'deepseek_count'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN ai_provider = "OpenAI" THEN 1 END')), 'openai_count'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN ai_provider = "Fallback" THEN 1 END')), 'fallback_count']
        ],
        where: {
            created_at: { [Op.gte]: startTimestamp }
        },
        raw: true
    });
    
    return stats[0];
};

module.exports = UserTeacherRecommendation;