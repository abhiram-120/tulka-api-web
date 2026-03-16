const bcrypt = require('bcrypt');
const multer = require('multer');
const User = require('../../models/users');
const Class = require('../../models/classes');
const { sequelize } = require('../../connection/connection');
const { Op } = require('sequelize');
const { validateProfileData } = require('../../validators/teacher/teacher-profile.validator');
const { uploadAvatar, uploadVideo, uploadThumbnail } = require('../../services/profile/image-service');
const UserOccupation = require('../../models/usersOccupation');

/**
 * Get teacher profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTeacherProfile = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get user with specific attributes
        const user = await User.findByPk(userId, {
            attributes: [
                'id', 
                'full_name', 
                'email', 
                'mobile',
                'country_code',
                'language',
                'timezone',
                'city',
                'avatar',
                'role_name',
                'notification_channels',
                'lesson_notifications',
                'subject',
                'education',
                'experience',
                'about',
                'video_demo',
                'video_demo_thumb',
                'headline',
                'add_zoom_link',
                'add_zoom_link_meeting_id',
                'add_zoom_link_access_code',
                'enable_zoom_link'
            ]
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Verify user is a teacher role
        if (!user.role_name.includes('teacher')) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Format notification preferences
        const notificationPreferences = {
            email: user.notification_channels ? JSON.parse(user.notification_channels).includes('email') : false,
            whatsapp: user.notification_channels ? JSON.parse(user.notification_channels).includes('whatsapp') : false,
            inapp: user.notification_channels ? JSON.parse(user.notification_channels).includes('inapp') : false,
            notification_times: user.lesson_notifications ? JSON.parse(user.lesson_notifications) : []
        };

        // Format zoom settings
        const zoomSettings = {
            use_zoom: user.enable_zoom_link || false,
            zoom_link: user.add_zoom_link || null,
            meeting_id: user.add_zoom_link_meeting_id || null,
            passcode: user.add_zoom_link_access_code || null
        };

        // Prepare response data
        const responseData = {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            mobile: user.mobile,
            country_code: user.country_code,
            language: user.language,
            timezone: user.timezone,
            city: user.city,
            avatar: user.avatar,
            role_name: user.role_name,
            subject: user.subject || null,
            education: user.education || null,
            experience: user.experience || null,
            about: user.about || null,
            video_demo: user.video_demo || null,
            video_demo_thumb: user.video_demo_thumb || null,
            teaching_name: user.headline || null,
            notification_preferences: notificationPreferences,
            zoom_settings: zoomSettings,
            bio: user.bio || null,
        };

        return res.status(200).json({
            status: 'success',
            data: responseData
        });

    } catch (error) {
        console.error('Error in getTeacherProfile:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update teacher profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateTeacherProfile = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;
        const {
            full_name,
            email,
            mobile,
            country_code,
            language,
            timezone,
            city,
            teaching_name
        } = req.body;

        // Input validation
        const validationError = validateProfileData(req.body);
        if (validationError) {
            return res.status(400).json({
                status: 'error',
                message: validationError
            });
        }

        // Verify user is a teacher role
        const user = await User.findByPk(userId);
        if (!user || !user.role_name.includes('teacher')) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if email is already taken (excluding current user)
        if (email) {
            const existingUser = await User.findOne({
                where: {
                    email,
                    id: { [Op.ne]: userId }
                },
                transaction
            });

            if (existingUser) {
                await transaction.rollback();
                return res.status(409).json({
                    status: 'error',
                    message: 'Email is already taken'
                });
            }
        }
        if (mobile) {
            const existingUser = await User.findOne({
                where: {
                    mobile,
                    id: { [Op.ne]: userId }
                },
                transaction
            });

            if (existingUser) {
                await transaction.rollback();
                return res.status(409).json({
                    status: 'error',
                    message: 'Mobile Number is already taken'
                });
            }
        }

        // Update user profile
        const updatedUser = await User.update({
            full_name,
            email,
            mobile,
            country_code,
            language,
            timezone,
            city,
            headline: teaching_name, // Store teaching_name in headline field
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: userId },
            returning: true,
            transaction
        });

        await transaction.commit();

        // Fetch updated user data
        const teacherUser = await User.findByPk(userId, {
            attributes: [
                'id', 
                'full_name', 
                'email', 
                'mobile',
                'country_code',
                'language',
                'timezone',
                'city',
                'avatar',
                'role_name',
                'headline'
            ]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Profile updated successfully',
            data: {
                ...teacherUser.toJSON(),
                teaching_name: teacherUser.headline
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in updateTeacherProfile:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Change teacher user password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const changeTeacherPassword = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        // Validate input
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                status: 'error',
                message: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                status: 'error',
                message: 'New password must be at least 8 characters long'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Get user with password and verify role
        const user = await User.findByPk(userId, { transaction });

        if (!user) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Verify user is a teacher role
        if (!user.role_name.includes('teacher')) {
            await transaction.rollback();
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Verify current password
        let hashPassword = user.password.replace(/^\$2y(.+)$/i, '$2a$1');
        const isPasswordValid = await bcrypt.compare(currentPassword, hashPassword);
        if (!isPasswordValid) {
            await transaction.rollback();
            return res.status(401).json({
                status: 'error',
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await User.update({
            password: hashedPassword,
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: userId },
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Password changed successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in changeTeacherPassword:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Upload avatar for teacher user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const uploadTeacherAvatar = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                status: 'error',
                message: 'No file uploaded'
            });
        }

        const response = await uploadAvatar(req.user.id, req.file);

        if (!response.success) {
            return res.status(400).json({
                status: 'error',
                message: response.error
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Avatar uploaded successfully',
            data: response.data
        });

    } catch (error) {
        console.error('Error in uploadTeacherAvatar:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update notification preferences
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateNotificationPreferences = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;
        const { email, whatsapp, inapp = false, notification_times } = req.body;
        console.log('Notification preferences:', req.body);
        

        if (typeof email !== 'boolean' || typeof whatsapp !== 'boolean' || !Array.isArray(notification_times)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid notification preferences format'
            });
        }

        // Valid notification times values
        const validTimes = ['24', '4', '1', '30'];
        const validNotificationTimes = notification_times.filter(time => validTimes.includes(time));

        if (validNotificationTimes.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'At least one valid notification time is required'
            });
        }

        if (validNotificationTimes.length > 2) {
            return res.status(400).json({
                status: 'error',
                message: 'Maximum 2 notification times allowed'
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

        // Create notification channels array
        const notificationChannels = [];
        if (email) notificationChannels.push('email');
        if (whatsapp) notificationChannels.push('whatsapp');
        if (inapp) notificationChannels.push('inapp');

        // Map notification times
        const timeMap = {
            '24': '24',
            '4': '4',
            '1': '1',
            '30': '30'
        };

        const mappedTimes = validNotificationTimes.map(time => timeMap[time]);

        // Update user notification preferences
        await User.update({
            notification_channels: JSON.stringify(notificationChannels),
            lesson_notifications: JSON.stringify(mappedTimes),
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: userId },
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Notification preferences updated successfully',
            data: {
                email,
                whatsapp,
                inapp,
                notification_times: validNotificationTimes
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in updateNotificationPreferences:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update Zoom settings and update pending classes with new Zoom links
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateZoomSettings = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;
        const { use_zoom, zoom_link, meeting_id, passcode } = req.body;

        // Validate input
        if (typeof use_zoom !== 'boolean') {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid zoom settings format'
            });
        }

        // If enabled, validate either zoom_link or meeting_id is provided
        if (use_zoom && !zoom_link && !meeting_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Either Zoom link or Meeting ID is required when Zoom is enabled'
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

        // Update user zoom settings
        await User.update({
            enable_zoom_link: use_zoom,
            add_zoom_link: zoom_link || null,
            add_zoom_link_meeting_id: meeting_id || null,
            add_zoom_link_access_code: passcode || null,
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: userId },
            transaction
        });

        // If Zoom is enabled and zoom_link is provided, update all pending classes
        if (use_zoom && zoom_link) {
            // Get all pending classes for this teacher
            const pendingClasses = await Class.findAll({
                where: {
                    teacher_id: userId,
                    status: 'pending'
                },
                transaction
            });

            // Update all pending classes with the new Zoom link
            if (pendingClasses.length > 0) {
                await Class.update({
                    join_url: zoom_link,
                    admin_url: zoom_link,
                    updated_at: new Date()
                }, {
                    where: {
                        teacher_id: userId,
                        status: 'pending'
                    },
                    transaction
                });

                console.log(`Updated ${pendingClasses.length} pending classes with new Zoom link for teacher ${userId}`);
            }
        }

        await transaction.commit();

        // Get the count of updated classes for response
        const updatedClassesCount = use_zoom && zoom_link ? 
            await Class.count({
                where: {
                    teacher_id: userId,
                    status: 'pending'
                }
            }) : 0;

        return res.status(200).json({
            status: 'success',
            message: 'Zoom settings updated successfully',
            data: {
                use_zoom,
                zoom_link: zoom_link || null,
                meeting_id: meeting_id || null,
                passcode: passcode || null,
                updated_classes_count: updatedClassesCount
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in updateZoomSettings:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update teaching details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateTeachingDetails = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;
        // Extract all form fields
        const { bio, subject, education, experience, video_demo } = req.body;
        
        // Store new thumbnail URL if it's uploaded
        let videoThumbUrl = null;
        // Check if a thumbnail file was uploaded
        if (req.file) {
            // Use the existing uploadThumbnail function to process the file
            const thumbnailResponse = await uploadThumbnail(userId, req.file);
            
            if (thumbnailResponse.success) {
                videoThumbUrl = thumbnailResponse.data.fileName;
            } else {
                return res.status(400).json({
                    status: 'error',
                    message: 'Failed to upload thumbnail: ' + thumbnailResponse.error
                });
            }
        } else {
            // If no file was uploaded but there's a URL in the form data, use that
            videoThumbUrl = req.body.video_demo_thumb;
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

        // Update teaching details
        await User.update({
            about: bio || null,
            experience: experience || null, // Store experience in the about field
            education: education || null, // Store education in the site_intro field
            subject: subject || null, // Store subject in the account_type field
            video_demo: video_demo || null,
            video_demo_thumb: videoThumbUrl || null,
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: userId },
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Teaching details updated successfully',
            data: {
                bio: bio || null,
                subject: subject || null,
                education: education || null,
                experience: experience || null,
                video_demo: video_demo || null,
                video_demo_thumb: videoThumbUrl || null
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in updateTeachingDetails:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Upload introduction video
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const uploadIntroVideo = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                status: 'error',
                message: 'No file uploaded'
            });
        }

        const response = await uploadVideo(req.user.id, req.file);

        if (!response.success) {
            return res.status(400).json({
                status: 'error',
                message: response.error
            });
        }

        // Update user record with video info
        await User.update({
            video_demo: response.data.url,
            video_demo_source: 'upload',
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: req.user.id }
        });

        return res.status(200).json({
            status: 'success',
            message: 'Video uploaded successfully',
            data: response.data
        });

    } catch (error) {
        console.error('Error in uploadIntroVideo:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Upload video thumbnail
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const uploadVideoThumbnail = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                status: 'error',
                message: 'No file uploaded'
            });
        }

        const response = await uploadThumbnail(req.user.id, req.file);

        if (!response.success) {
            return res.status(400).json({
                status: 'error',
                message: response.error
            });
        }

        // Update user record with thumbnail info
        await User.update({
            video_demo_thumb: response.data.url,
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: req.user.id }
        });

        return res.status(200).json({
            status: 'success',
            message: 'Thumbnail uploaded successfully',
            data: response.data
        });

    } catch (error) {
        console.error('Error in uploadVideoThumbnail:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Add YouTube video
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const addYoutubeVideo = async (req, res) => {
    try {
        const { youtube_url, thumbnail_url } = req.body;

        if (!youtube_url) {
            return res.status(400).json({
                status: 'error',
                message: 'YouTube URL is required'
            });
        }

        // Extract video ID from URL
        const videoIdMatch = youtube_url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        
        if (!videoIdMatch || !videoIdMatch[1]) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid YouTube URL'
            });
        }

        const videoId = videoIdMatch[1];
        const embedUrl = `https://www.youtube.com/embed/${videoId}`;

        // Update user record with video info
        await User.update({
            video_demo: embedUrl,
            video_demo_source: 'youtube',
            video_demo_thumb: thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: req.user.id }
        });

        return res.status(200).json({
            status: 'success',
            message: 'YouTube video added successfully',
            data: {
                url: embedUrl,
                thumbnailUrl: thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
            }
        });

    } catch (error) {
        console.error('Error in addYoutubeVideo:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Upload class video
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const uploadClassVideo = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                status: 'error',
                message: 'No file uploaded'
            });
        }

        const response = await uploadVideo(req.user.id, req.file);

        if (!response.success) {
            return res.status(400).json({
                status: 'error',
                message: response.error
            });
        }

        // Here you would typically save to a class videos table
        // For now, just return success response
        return res.status(200).json({
            status: 'success',
            message: 'Class video uploaded successfully',
            data: response.data
        });

    } catch (error) {
        console.error('Error in uploadClassVideo:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Delete video
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteVideo = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;
        const videoId = req.params.id;

        if (!videoId) {
            return res.status(400).json({
                status: 'error',
                message: 'Video ID is required'
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

        // Implement video deletion logic here
        // This would typically involve:
        // 1. Finding the video in your database
        // 2. Checking if it belongs to the current user
        // 3. Deleting the file from storage
        // 4. Removing the database record

        // For the intro video specifically, you could clear it from the user record:
        if (videoId === 'intro') {
            // Delete actual file if it exists
            // if (user.video_demo) {
            //     await deleteVideo(user.video_demo);
            // }
            
            // Clear user's video fields
            await User.update({
                video_demo: null,
                video_demo_thumb: null,
                video_demo_source: null,
                updated_at: Math.floor(Date.now() / 1000)
            }, {
                where: { id: userId },
                transaction
            });
        } else {
            // For other videos, you would implement logic to find and delete them
            // This depends on your data model for class videos
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Video deleted successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in deleteVideo:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const getTeacherSkills = async (req, res) => {
  try {
    const userId = req.user.id;

    const rows = await UserOccupation.findAll({ where: { user_id: userId } });

    const result = {
      specialties: [],
      also_speaks: [],
      teachings: [],
      levels: []
    };

    rows.forEach((r) => {
      if (r.type === "specialties") result.specialties.push(r.value);
      if (r.type === "also_speaking") result.also_speaks.push(r.value);
      if (r.type === "teachings") result.teachings.push(r.value);
      if (r.type === "levels") result.levels.push(r.value);
    });

    return res.json({ success: true, data: result });

  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ success: false });
  }
};


const saveTeacherSkills = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware
    const { specialties = [], also_speaks = [], teachings = [], levels = [] } = req.body;

    // Clear old skills for clean overwrite
    await UserOccupation.destroy({ where: { user_id: userId } });

    let rows = [];

    const pushRows = (type, arr) => {
      arr.forEach((value) => {
        rows.push({
          user_id: userId,
          type,
          value,
        });
      });
    };

    pushRows("specialties", specialties);
    pushRows("also_speaking", also_speaks);
    pushRows("teachings", teachings);
    pushRows("levels", levels);

    // Bulk insert
    if (rows.length > 0) {
      await UserOccupation.bulkCreate(rows);
    }

    return res.json({ success: true, message: "Skills saved successfully" });
  } catch (err) {
    console.error("❌ Error saving teacher skills:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Configure multer for file upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit for videos
    }
});

const thumbnailUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit for images
    }
});

module.exports = {
    getTeacherProfile,
    updateTeacherProfile,
    changeTeacherPassword,
    uploadTeacherAvatar,
    updateNotificationPreferences,
    updateZoomSettings,
    updateTeachingDetails,
    uploadIntroVideo,
    uploadVideoThumbnail,
    addYoutubeVideo,
    uploadClassVideo,  // Add this
    deleteVideo,       // Add this
    upload,
    thumbnailUpload,
    saveTeacherSkills,
    getTeacherSkills
};
