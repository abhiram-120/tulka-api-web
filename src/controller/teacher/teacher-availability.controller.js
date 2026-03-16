const TeacherAvailability = require('../../models/teacherAvailability');
const User = require('../../models/users');
const { sequelize } = require('../../connection/connection');
const { Op } = require('sequelize');

/**
 * Get teacher availability
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTeacherAvailability = async (req, res) => {
    try {
        const userId = req.user.id;

        // Verify user is a teacher role
        const user = await User.findByPk(userId);
        if (!user || !user.role_name.includes('teacher')) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Get availability data
        let availability = await TeacherAvailability.findOne({
            where: { user_id: userId }
        });

        // If no availability record exists, create a default one
        if (!availability) {
            availability = await TeacherAvailability.create({
                user_id: userId,
                mon: '{}',
                tue: '{}',
                wed: '{}',
                thu: '{}',
                fri: '{}',
                sat: '{}',
                sun: '{}'
            });
        }

        // Format the response data - parse JSON strings into arrays
        const responseData = {
            id: availability.id,
            user_id: availability.user_id,
            sun: JSON.parse(availability.sun || '{}'),
            mon: JSON.parse(availability.mon || '{}'),
            tue: JSON.parse(availability.tue || '{}'),
            wed: JSON.parse(availability.wed || '{}'),
            thu: JSON.parse(availability.thu || '{}'),
            fri: JSON.parse(availability.fri || '{}'),
            sat: JSON.parse(availability.sat || '{}')
        };

        return res.status(200).json({
            status: 'success',
            data: responseData
        });

    } catch (error) {
        console.error('Error in getTeacherAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update teacher availability
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateTeacherAvailability = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;
        const { sun, mon, tue, wed, thu, fri, sat } = req.body;

        // Validate input
        const days = { sun, mon, tue, wed, thu, fri, sat };
        for (const [day, slots] of Object.entries(days)) {
            if (!Array.isArray(slots)) {
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid format for ${day}. Expected an array.`
                });
            }

            // Validate each time slot format (should be in HH:MM format)
            for (const slot of slots) {
                if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(slot)) {
                    return res.status(400).json({
                        status: 'error',
                        message: `Invalid time format in ${day}: ${slot}. Expected HH:MM format.`
                    });
                }
            }
        }

        // Verify user is a teacher
        const user = await User.findByPk(userId);
        if (!user || !user.role_name.includes('teacher')) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if availability record exists
        let availability = await TeacherAvailability.findOne({
            where: { user_id: userId },
            transaction
        });

        // Update or create availability record
        if (availability) {
            await TeacherAvailability.update({
                sun: JSON.stringify(sun),
                mon: JSON.stringify(mon),
                tue: JSON.stringify(tue),
                wed: JSON.stringify(wed),
                thu: JSON.stringify(thu),
                fri: JSON.stringify(fri),
                sat: JSON.stringify(sat)
            }, {
                where: { user_id: userId },
                transaction
            });
        } else {
            await TeacherAvailability.create({
                user_id: userId,
                sun: JSON.stringify(sun),
                mon: JSON.stringify(mon),
                tue: JSON.stringify(tue),
                wed: JSON.stringify(wed),
                thu: JSON.stringify(thu),
                fri: JSON.stringify(fri),
                sat: JSON.stringify(sat)
            }, {
                transaction
            });
        }

        await transaction.commit();

        // Get updated availability
        const updatedAvailability = await TeacherAvailability.findOne({
            where: { user_id: userId }
        });

        // Format the response data
        const responseData = {
            id: updatedAvailability.id,
            user_id: updatedAvailability.user_id,
            sun: JSON.parse(updatedAvailability.sun || '{}'),
            mon: JSON.parse(updatedAvailability.mon || '{}'),
            tue: JSON.parse(updatedAvailability.tue || '{}'),
            wed: JSON.parse(updatedAvailability.wed || '{}'),
            thu: JSON.parse(updatedAvailability.thu || '{}'),
            fri: JSON.parse(updatedAvailability.fri || '{}'),
            sat: JSON.parse(updatedAvailability.sat || '{}')
        };

        return res.status(200).json({
            status: 'success',
            message: 'Availability updated successfully',
            data: responseData
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in updateTeacherAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Save availability from UI grid format
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const saveGridAvailability = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;
        const { selectedSlots } = req.body;

        // Validate input
        if (!selectedSlots || typeof selectedSlots !== 'object') {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid selectedSlots format'
            });
        }

        // Verify user is a teacher
        const user = await User.findByPk(userId);
        if (!user || !user.role_name.includes('teacher')) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Transform grid data into day-based objects
        const daysMap = {
            sun: {},
            mon: {},
            tue: {},
            wed: {},
            thu: {},
            fri: {},
            sat: {}
        };

        // Process each time slot
        for (const [time, daySelections] of Object.entries(selectedSlots)) {
            // Skip the "All days" pseudo-column, only process real days
            for (const [day, isSelected] of Object.entries(daySelections)) {
                // Skip the "All days" header selection
                if (day === 'All days') continue;
                
                // Map day names to lowercase for the database
                const dayKey = day.toLowerCase();
                
                // Only process valid days
                if (daysMap[dayKey] !== undefined) {
                    // Store the selection state for this time slot
                    daysMap[dayKey][time] = Boolean(isSelected);
                }
            }
        }

        // Check if availability record exists
        let availability = await TeacherAvailability.findOne({
            where: { user_id: userId },
            transaction
        });

        // Update or create availability record
        if (availability) {
            await TeacherAvailability.update({
                sun: JSON.stringify(daysMap.sun),
                mon: JSON.stringify(daysMap.mon),
                tue: JSON.stringify(daysMap.tue),
                wed: JSON.stringify(daysMap.wed),
                thu: JSON.stringify(daysMap.thu),
                fri: JSON.stringify(daysMap.fri),
                sat: JSON.stringify(daysMap.sat)
            }, {
                where: { user_id: userId },
                transaction
            });
        } else {
            await TeacherAvailability.create({
                user_id: userId,
                sun: JSON.stringify(daysMap.sun),
                mon: JSON.stringify(daysMap.mon),
                tue: JSON.stringify(daysMap.tue),
                wed: JSON.stringify(daysMap.wed),
                thu: JSON.stringify(daysMap.thu),
                fri: JSON.stringify(daysMap.fri),
                sat: JSON.stringify(daysMap.sat)
            }, {
                transaction
            });
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Availability updated successfully',
            data: daysMap
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in saveGridAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Convert availability to grid format for UI
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getGridAvailability = async (req, res) => {
    try {
        const userId = req.user.id;

        // Verify user is a teacher role
        const user = await User.findByPk(userId);
        if (!user || !user.role_name.includes('teacher')) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Get availability data
        let availability = await TeacherAvailability.findOne({
            where: { user_id: userId }
        });

        // Generate time slots from 00:00 to 23:30 in 30-minute increments
        const timeSlots = Array.from({ length: 48 }, (_, i) => {
            const hour = Math.floor(i / 2).toString().padStart(2, '0');
            const minute = i % 2 === 0 ? '00' : '30';
            return `${hour}:${minute}`;
        });

        // If no availability record exists, return empty grid
        if (!availability) {
            const days = ['All days', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            
            // Create empty grid
            const emptyGrid = {};
            timeSlots.forEach(time => {
                emptyGrid[time] = days.reduce((acc, day) => {
                    acc[day] = false;
                    return acc;
                }, {});
            });

            return res.status(200).json({
                status: 'success',
                data: emptyGrid
            });
        }

        // Helper function to safely parse JSON
        const safeParseJson = (jsonString) => {
            try {
                if (!jsonString) return {};
                const parsed = JSON.parse(jsonString);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                console.error('Error parsing JSON:', e);
                return {}; 
            }
        };

        // Parse availability data from database
        const availabilityData = {
            sun: safeParseJson(availability.sun),
            mon: safeParseJson(availability.mon),
            tue: safeParseJson(availability.tue),
            wed: safeParseJson(availability.wed),
            thu: safeParseJson(availability.thu),
            fri: safeParseJson(availability.fri),
            sat: safeParseJson(availability.sat)
        };

        // console.log('Parsed availability data:', availabilityData);

        // Create grid structure
        const gridData = {};
        timeSlots.forEach(time => {
            gridData[time] = {
                'All days': false,
                'Sun': Boolean(availabilityData.sun[time]),
                'Mon': Boolean(availabilityData.mon[time]),
                'Tue': Boolean(availabilityData.tue[time]),
                'Wed': Boolean(availabilityData.wed[time]),
                'Thu': Boolean(availabilityData.thu[time]),
                'Fri': Boolean(availabilityData.fri[time]),
                'Sat': Boolean(availabilityData.sat[time])
            };
        });

        return res.status(200).json({
            status: 'success',
            data: gridData
        });

    } catch (error) {
        console.error('Error in getGridAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Clear all availability
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const clearAvailability = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;

        // Verify user is a teacher
        const user = await User.findByPk(userId);
        if (!user || !user.role_name.includes('teacher')) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if availability record exists
        const availability = await TeacherAvailability.findOne({
            where: { user_id: userId },
            transaction
        });

        if (availability) {
            // Reset all days to empty arrays
            await TeacherAvailability.update({
                sun: '{}',
                mon: '{}',
                tue: '{}',
                wed: '{}',
                thu: '{}',
                fri: '{}',
                sat: '{}'
            }, {
                where: { user_id: userId },
                transaction
            });
        } else {
            // Create empty availability record
            await TeacherAvailability.create({
                user_id: userId,
                sun: '{}',
                mon: '{}',
                tue: '{}',
                wed: '{}',
                thu: '{}',
                fri: '{}',
                sat: '{}'
            }, {
                transaction
            });
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Availability cleared successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in clearAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    getTeacherAvailability,
    updateTeacherAvailability,
    saveGridAvailability,
    getGridAvailability,
    clearAvailability
};