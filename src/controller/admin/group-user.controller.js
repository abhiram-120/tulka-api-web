const GroupUser = require('../../models/group-user');
const { validationResult } = require('express-validator');

/**
 * Get all group users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with group users data
 */
async function getGroupUsers(req, res) {
    try {
        const groupUsers = await GroupUser.findAll({
            order: [['created_at', 'DESC']]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Group users fetched successfully',
            data: groupUsers
        });
    } catch (err) {
        console.error('Error fetching group users:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch group users'
        });
    }
}

/**
 * Get group users by group ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with group users data
 */
async function getGroupUsersByGroupId(req, res) {
    try {
        const { groupId } = req.params;
        const groupUsers = await GroupUser.findAll({
            where: { group_id: groupId },
            order: [['created_at', 'DESC']]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Group users fetched successfully',
            data: groupUsers
        });
    } catch (err) {
        console.error('Error fetching group users:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch group users'
        });
    }
}

/**
 * Create a new group user association
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with created group user data
 */
async function store(req, res) {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                status: 'error',
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { group_id, user_id } = req.body;

        // Check if association already exists
        const existingAssociation = await GroupUser.findOne({
            where: {
                group_id,
                user_id
            }
        });

        if (existingAssociation) {
            return res.status(400).json({
                status: 'error',
                message: 'User is already in this group'
            });
        }

        const groupUser = await GroupUser.create({
            group_id,
            user_id,
            created_at: Math.floor(Date.now() / 1000)
        });

        return res.status(201).json({
            status: 'success',
            message: 'User added to group successfully',
            data: groupUser
        });
    } catch (err) {
        console.error('Error creating group user:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to add user to group'
        });
    }
}

/**
 * Remove a user from a group
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with deletion status
 */
async function destroy(req, res) {
    try {
        const { group_id, user_id } = req.params;

        const deleted = await GroupUser.destroy({
            where: {
                group_id,
                user_id
            }
        });

        if (!deleted) {
            return res.status(404).json({
                status: 'error',
                message: 'Group user association not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'User removed from group successfully'
        });
    } catch (err) {
        console.error('Error removing user from group:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to remove user from group'
        });
    }
}

module.exports = {
    getGroupUsers,
    getGroupUsersByGroupId,
    store,
    destroy
};