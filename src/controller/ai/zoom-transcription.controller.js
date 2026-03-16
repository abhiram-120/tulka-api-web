// Zoom Audio Transcription Controller
// Author: Ashish Sahu - SAHIONEXT TECHNOLOGY PRIVATE LIMITED
// Description: Handles Zoom recording downloads and AI transcription

const Joi = require('joi');
const axios = require('axios');

// Models (you'll need to create these)
const ZoomTranscription = require('../../models/zoomTranscription.model');
const Users = require('../../models/users');

// Configuration from environment variables
const ZOOM_CONFIG = {
    CLIENT_ID: process.env.ZOOM_CLIENT_ID,
    CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET,
    ACCOUNT_ID: process.env.ZOOM_ACCOUNT_ID
};

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const transcriptionRequestSchema = Joi.object({
    teacherEmail: Joi.string().email().required(),
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).allow(null, ''),
    endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).allow(null, ''),
    user_id: Joi.string().required(),
    teacher_id: Joi.string().required(),
    class_id: Joi.string().required()
});

// ============================================================================
// ZOOM API FUNCTIONS
// ============================================================================

/**
 * Get Zoom OAuth token using Server-to-Server OAuth
 */
async function getZoomAccessToken() {
    try {
        const authString = Buffer.from(
            `${ZOOM_CONFIG.CLIENT_ID}:${ZOOM_CONFIG.CLIENT_SECRET}`
        ).toString('base64');

        const response = await axios.post(
            `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_CONFIG.ACCOUNT_ID}`,
            {},
            {
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        return response.data.access_token;
    } catch (error) {
        console.error('Error getting Zoom access token:', error.response?.data || error.message);
        throw new Error('Failed to authenticate with Zoom');
    }
}

/**
 * Fetch Zoom recordings for a specific user and date
 */
async function fetchZoomRecordings(teacherEmail, date) {
    try {
        const accessToken = await getZoomAccessToken();
        
        const response = await axios.get(
            `https://api.zoom.us/v2/users/${encodeURIComponent(teacherEmail)}/recordings`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                params: {
                    from: date,
                    to: date
                }
            }
        );

        return response.data;
    } catch (error) {
        console.error('Error fetching Zoom recordings:', error.response?.data || error.message);
        throw new Error('Failed to fetch Zoom recordings');
    }
}

/**
 * Download audio file from Zoom
 */
async function downloadZoomAudio(downloadUrl) {
    try {
        const accessToken = await getZoomAccessToken();
        
        const response = await axios.get(downloadUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            responseType: 'arraybuffer'
        });

        return response.data;
    } catch (error) {
        console.error('Error downloading Zoom audio:', error.response?.data || error.message);
        throw new Error('Failed to download audio from Zoom');
    }
}

// ============================================================================
// TIME FILTERING HELPERS
// ============================================================================

/**
 * Extract UTC time from ISO string
 */
function getUTCTimeFromISOString(isoString) {
    try {
        const date = new Date(isoString);
        const utcHours = date.getUTCHours().toString().padStart(2, '0');
        const utcMinutes = date.getUTCMinutes().toString().padStart(2, '0');
        return `${utcHours}:${utcMinutes}`;
    } catch (error) {
        console.error('Time parsing error:', error);
        return null;
    }
}

/**
 * Convert time string to minutes
 */
function timeToMinutes(timeStr) {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

/**
 * Check if meeting time is within the specified range
 */
function isTimeInRange(meetingTime, startTime, endTime) {
    if (!startTime || !endTime) {
        return true; // No time filter
    }
    
    const meetingTimeStr = getUTCTimeFromISOString(meetingTime);
    if (!meetingTimeStr) return false;
    
    const meetingMinutes = timeToMinutes(meetingTimeStr);
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    
    if (meetingMinutes === null || startMinutes === null || endMinutes === null) {
        return false;
    }
    
    // Exclude meetings that start exactly at end time
    if (meetingTimeStr === endTime) {
        return false;
    }
    
    // Handle midnight spanning (e.g., 23:00 to 01:00)
    if (endMinutes < startMinutes) {
        return meetingMinutes >= startMinutes || meetingMinutes < endMinutes;
    } else {
        return meetingMinutes >= startMinutes && meetingMinutes < endMinutes;
    }
}

/**
 * Find audio file in recording files
 */
function findAudioFile(recordingFiles) {
    if (!recordingFiles || !Array.isArray(recordingFiles)) return null;
    
    const audioFile = recordingFiles.find(file => {
        // Check for audio_only recording type
        if (file.recording_type === 'audio_only') return true;
        
        // Check for audio file types
        if (file.file_type && ['m4a', 'mp3', 'wav', 'aac', 'ogg'].includes(file.file_type.toLowerCase())) {
            return true;
        }
        
        // Check for audio interpretation or small screen recordings
        if (file.recording_type && [
            'audio_interpretation',
            'shared_screen_with_speaker_view'
        ].includes(file.recording_type)) {
            return file.file_size && file.file_size < 100 * 1024 * 1024; // < 100MB
        }
        
        return false;
    });
    
    return audioFile || null;
}

/**
 * Filter Zoom recordings based on criteria
 */
function filterRecordings(zoomResponse, targetDate, startTime, endTime) {
    const meetings = zoomResponse.meetings || [];
    const filteredRecordings = [];
    
    console.log(`\n📋 Checking ${meetings.length} meetings...`);
    
    for (const meeting of meetings) {
        const meetingDate = new Date(meeting.start_time).toISOString().split('T')[0];
        const meetingTime = getUTCTimeFromISOString(meeting.start_time);
        
        console.log(`\n🔍 Meeting: ${meeting.topic} (${meetingTime})`);
        
        if (!meeting.recording_files || meeting.recording_files.length === 0) {
            console.log('   ❌ No recordings found');
            continue;
        }
        
        // Check date match
        const dateMatches = !targetDate || meetingDate === targetDate;
        console.log(`   📅 Date match: ${dateMatches}`);
        
        // Check time match
        const timeMatches = isTimeInRange(meeting.start_time, startTime, endTime);
        console.log(`   🕐 Time match: ${timeMatches}`);
        
        // Find audio file
        const audioFile = findAudioFile(meeting.recording_files);
        const hasAudio = !!audioFile;
        console.log(`   🎵 Has audio: ${hasAudio}`);
        
        if (dateMatches && timeMatches && hasAudio) {
            console.log('   ✅ INCLUDED');
            
            filteredRecordings.push({
                meeting_id: meeting.id,
                topic: meeting.topic,
                start_time: meeting.start_time,
                meeting_time: meetingTime,
                audio_file: audioFile
            });
        } else {
            const reasons = [];
            if (!dateMatches) reasons.push('date mismatch');
            if (!timeMatches) reasons.push('time mismatch');
            if (!hasAudio) reasons.push('no audio files');
            console.log(`   ❌ EXCLUDED: ${reasons.join(', ')}`);
        }
    }
    
    console.log(`\n📊 Found ${filteredRecordings.length} matching recordings`);
    return filteredRecordings;
}

// ============================================================================
// ASSEMBLYAI FUNCTIONS
// ============================================================================

/**
 * Upload audio to AssemblyAI
 */
async function uploadToAssemblyAI(audioBuffer) {
    try {
        console.log('📤 Uploading audio to AssemblyAI...');
        
        const response = await axios.post(
            'https://api.assemblyai.com/v2/upload',
            audioBuffer,
            {
                headers: {
                    'authorization': ASSEMBLYAI_API_KEY,
                    'content-type': 'application/octet-stream'
                }
            }
        );

        console.log('✅ Audio uploaded successfully');
        return response.data.upload_url;
    } catch (error) {
        console.error('Error uploading to AssemblyAI:', error.response?.data || error.message);
        throw new Error('Failed to upload audio to AssemblyAI');
    }
}

/**
 * Create transcription job on AssemblyAI
 */
async function createTranscription(uploadUrl) {
    try {
        console.log('🎙️ Creating transcription job...');
        
        const response = await axios.post(
            'https://api.assemblyai.com/v2/transcript',
            {
                audio_url: uploadUrl,
                speaker_labels: true
            },
            {
                headers: {
                    'authorization': ASSEMBLYAI_API_KEY,
                    'content-type': 'application/json'
                }
            }
        );

        console.log('✅ Transcription job created:', response.data.id);
        return response.data.id;
    } catch (error) {
        console.error('Error creating transcription:', error.response?.data || error.message);
        throw new Error('Failed to create transcription job');
    }
}

/**
 * Poll AssemblyAI for transcription status
 */
async function pollTranscription(transcriptId, maxAttempts = 60) {
    console.log('⏳ Polling for transcription completion...');
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await axios.get(
                `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
                {
                    headers: {
                        'authorization': ASSEMBLYAI_API_KEY
                    }
                }
            );

            const status = response.data.status;
            console.log(`   Attempt ${attempt}/${maxAttempts}: Status = ${status}`);

            if (status === 'completed') {
                console.log('✅ Transcription completed!');
                return response.data;
            } else if (status === 'error') {
                throw new Error(`Transcription failed: ${response.data.error}`);
            }

            // Wait 5 seconds before next poll
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            if (error.response?.status !== 404) {
                console.error('Error polling transcription:', error.response?.data || error.message);
            }
            
            if (attempt === maxAttempts) {
                throw new Error('Transcription polling timeout');
            }
        }
    }
    
    throw new Error('Transcription took too long');
}

/**
 * Format transcription result
 */
function formatTranscript(transcriptionData, meetingInfo) {
    let formatted = `# Meeting Transcript (AssemblyAI)\n\n`;
    formatted += `**Meeting Information:**\n`;
    formatted += `- **Topic:** ${meetingInfo.topic || 'Meeting Recording'}\n`;
    formatted += `- **Host/Teacher:** ${meetingInfo.teacher || 'Unknown'}\n`;
    formatted += `- **Date:** ${meetingInfo.meetingDate || 'Unknown'}\n`;
    formatted += `- **Time:** ${meetingInfo.meetingTime || 'Unknown'}\n`;
    formatted += `- **Duration:** ${transcriptionData.audio_duration ? Math.round(transcriptionData.audio_duration) + ' seconds' : 'Unknown'}\n`;
    formatted += `- **User ID:** ${meetingInfo.userId || 'Unknown'}\n`;
    formatted += `- **Teacher ID:** ${meetingInfo.teacherId || 'Unknown'}\n`;
    formatted += `- **Class ID:** ${meetingInfo.classId || 'Unknown'}\n\n`;
    formatted += `## Full Transcript\n\n${transcriptionData.text}\n\n`;
    
    if (transcriptionData.utterances && transcriptionData.utterances.length > 0) {
        formatted += `## Speaker Breakdown\n\n`;
        const speakerStats = {};
        
        transcriptionData.utterances.forEach(utterance => {
            const speaker = utterance.speaker || 'Unknown';
            if (!speakerStats[speaker]) {
                speakerStats[speaker] = { count: 0, totalChars: 0 };
            }
            speakerStats[speaker].count++;
            speakerStats[speaker].totalChars += (utterance.text || '').length;
        });
        
        Object.keys(speakerStats).forEach(speaker => {
            const stats = speakerStats[speaker];
            formatted += `- **${speaker}:** ${stats.count} segments, ~${stats.totalChars} characters\n`;
        });
    }
    
    formatted += `\n---\n*Transcribed using AssemblyAI on ${new Date().toLocaleString()}*`;
    
    return formatted;
}

// ============================================================================
// MAIN CONTROLLER FUNCTIONS
// ============================================================================

/**
 * Process a single recording
 */
async function processRecording(recording, userParams) {
    try {
        const meetingDate = new Date(recording.start_time).toISOString().split('T')[0];
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`Processing: ${recording.topic}`);
        console.log(`${'='.repeat(80)}`);
        
        // Download audio
        console.log('📥 Downloading audio from Zoom...');
        const audioBuffer = await downloadZoomAudio(recording.audio_file.download_url);
        const fileSizeMB = (audioBuffer.byteLength / 1024 / 1024).toFixed(2);
        console.log(`✅ Audio downloaded: ${fileSizeMB} MB`);
        
        // Upload to AssemblyAI
        const uploadUrl = await uploadToAssemblyAI(audioBuffer);
        
        // Create transcription
        const transcriptId = await createTranscription(uploadUrl);
        
        // Poll for completion
        const transcriptionData = await pollTranscription(transcriptId);
        
        // Format transcript
        const formattedTranscript = formatTranscript(transcriptionData, {
            topic: recording.topic,
            teacher: userParams.teacherEmail,
            meetingDate: meetingDate,
            meetingTime: recording.meeting_time,
            userId: userParams.userId,
            teacherId: userParams.teacherId,
            classId: userParams.classId
        });
        
        // Store in database
        const transcriptionRecord = await ZoomTranscription.create({
            user_id: userParams.userId,
            teacher_id: userParams.teacherId,
            class_id: userParams.classId,
            teacher_email: userParams.teacherEmail,
            meeting_id: recording.meeting_id,
            meeting_topic: recording.topic,
            meeting_date: meetingDate,
            meeting_time: recording.meeting_time,
            time_range: `${userParams.startTime || 'N/A'} - ${userParams.endTime || 'N/A'}`,
            audio_file_name: `audio_${meetingDate}_${recording.meeting_time.replace(':', '-')}.mp3`,
            audio_file_size_mb: parseFloat(fileSizeMB),
            transcript: formattedTranscript,
            transcript_length: formattedTranscript.length,
            transcript_source: 'assemblyai',
            transcription_status: 'completed',
            processing_mode: 'audio_transcription',
            transcription_service: 'AssemblyAI',
            processing_started_at: new Date(),
            processing_completed_at: new Date()
        });
        
        console.log('✅ Processing complete!');
        return {
            success: true,
            recordId: transcriptionRecord.id,
            meetingId: recording.meeting_id,
            topic: recording.topic
        };
        
    } catch (error) {
        console.error(`❌ Error processing recording:`, error.message);
        return {
            success: false,
            error: error.message,
            meetingId: recording.meeting_id,
            topic: recording.topic
        };
    }
}

/**
 * Webhook endpoint - Request Zoom recording transcription
 * POST /adminZoomTranscription/request
 */
async function requestTranscription(req, res) {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('📨 New transcription request received');
        console.log('='.repeat(80));
        
        // Validate request body
        const { error, value } = transcriptionRequestSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                status: 'error',
                message: error.details[0].message
            });
        }
        
        const {
            teacherEmail,
            date,
            startTime,
            endTime,
            user_id: userId,
            teacher_id: teacherId,
            class_id: classId
        } = value;
        
        console.log('Request parameters:', {
            teacherEmail,
            date,
            startTime,
            endTime,
            userId,
            teacherId,
            classId
        });
        
        // Format date
        const targetDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        
        // Fetch Zoom recordings
        console.log(`\n🔍 Fetching Zoom recordings for ${teacherEmail}...`);
        const zoomResponse = await fetchZoomRecordings(teacherEmail, targetDate);
        
        // Filter recordings
        const filteredRecordings = filterRecordings(zoomResponse, targetDate, startTime, endTime);
        
        if (filteredRecordings.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No audio recordings found matching the criteria',
                data: {
                    teacherEmail,
                    date: targetDate,
                    timeRange: startTime && endTime ? `${startTime} - ${endTime}` : 'No time filter'
                }
            });
        }
        
        // Send immediate response
        res.status(200).json({
            status: 'success',
            message: 'Audio recordings found, processing started in background',
            data: {
                recordingsCount: filteredRecordings.length,
                userId,
                teacherId,
                classId,
                teacher: teacherEmail,
                date: targetDate,
                timeRange: startTime && endTime ? `${startTime} - ${endTime}` : 'No time filter',
                estimatedProcessingTime: '2-3 minutes',
                processingNote: 'Transcription results will be stored in database'
            }
        });
        
        // Process recordings in background
        const userParams = {
            teacherEmail,
            dateOnly: targetDate,
            startTime,
            endTime,
            userId,
            teacherId,
            classId
        };
        
        // Process all recordings (don't await - background processing)
        Promise.all(
            filteredRecordings.map(recording => processRecording(recording, userParams))
        ).then(results => {
            console.log('\n' + '='.repeat(80));
            console.log('📊 All recordings processed');
            console.log('='.repeat(80));
            console.log('Results:', JSON.stringify(results, null, 2));
        }).catch(error => {
            console.error('Error in background processing:', error);
        });
        
    } catch (err) {
        console.error('❌ Request transcription error:', err);
        return res.status(500).json({
            status: 'error',
            message: err.message || 'Internal server error while processing request'
        });
    }
}

/**
 * Get transcription by ID
 * GET /adminZoomTranscription/:id
 */
async function getTranscriptionById(req, res) {
    try {
        const { id } = req.params;
        
        const transcription = await ZoomTranscription.findByPk(id);
        
        if (!transcription) {
            return res.status(404).json({
                status: 'error',
                message: 'Transcription not found'
            });
        }
        
        return res.status(200).json({
            status: 'success',
            message: 'Transcription retrieved successfully',
            data: transcription
        });
        
    } catch (err) {
        console.error('Error fetching transcription:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching transcription'
        });
    }
}

/**
 * Get all transcriptions with filters
 * GET /adminZoomTranscription/list
 */
async function getTranscriptions(req, res) {
    try {
        const {
            user_id,
            teacher_id,
            class_id,
            meeting_date,
            status,
            page = 1,
            limit = 20
        } = req.query;
        
        const whereCondition = {};
        
        if (user_id) whereCondition.user_id = user_id;
        if (teacher_id) whereCondition.teacher_id = teacher_id;
        if (class_id) whereCondition.class_id = class_id;
        if (meeting_date) whereCondition.meeting_date = meeting_date;
        if (status) whereCondition.transcription_status = status;
        
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        const { count, rows: transcriptions } = await ZoomTranscription.findAndCountAll({
            where: whereCondition,
            limit: parseInt(limit),
            offset: offset,
            order: [['created_at', 'DESC']]
        });
        
        return res.status(200).json({
            status: 'success',
            message: 'Transcriptions retrieved successfully',
            data: {
                transcriptions,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count / parseInt(limit))
                }
            }
        });
        
    } catch (err) {
        console.error('Error fetching transcriptions:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching transcriptions'
        });
    }
}

/**
 * Delete transcription
 * DELETE /adminZoomTranscription/:id
 */
async function deleteTranscription(req, res) {
    try {
        const { id } = req.params;
        
        const transcription = await ZoomTranscription.findByPk(id);
        
        if (!transcription) {
            return res.status(404).json({
                status: 'error',
                message: 'Transcription not found'
            });
        }
        
        await transcription.destroy();
        
        return res.status(200).json({
            status: 'success',
            message: 'Transcription deleted successfully'
        });
        
    } catch (err) {
        console.error('Error deleting transcription:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while deleting transcription'
        });
    }
}

/**
 * Get transcription statistics
 * GET /adminZoomTranscription/stats
 */
async function getTranscriptionStats(req, res) {
    try {
        const { teacher_id, user_id, start_date, end_date } = req.query;
        
        const whereCondition = {};
        
        if (teacher_id) whereCondition.teacher_id = teacher_id;
        if (user_id) whereCondition.user_id = user_id;
        
        if (start_date && end_date) {
            whereCondition.meeting_date = {
                [Op.between]: [start_date, end_date]
            };
        }
        
        const stats = {
            totalTranscriptions: await ZoomTranscription.count({ where: whereCondition }),
            completedTranscriptions: await ZoomTranscription.count({ 
                where: { ...whereCondition, transcription_status: 'completed' } 
            }),
            failedTranscriptions: await ZoomTranscription.count({ 
                where: { ...whereCondition, transcription_status: 'failed' } 
            }),
            processingTranscriptions: await ZoomTranscription.count({ 
                where: { ...whereCondition, transcription_status: 'processing' } 
            }),
            totalAudioSizeMB: await ZoomTranscription.sum('audio_file_size_mb', { where: whereCondition }) || 0
        };
        
        return res.status(200).json({
            status: 'success',
            message: 'Statistics retrieved successfully',
            data: stats
        });
        
    } catch (err) {
        console.error('Error fetching statistics:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching statistics'
        });
    }
}

// MODULE EXPORTS
module.exports = {
    requestTranscription,
    getTranscriptionById,
    getTranscriptions,
    deleteTranscription,
    getTranscriptionStats
};