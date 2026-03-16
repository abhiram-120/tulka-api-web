// src/helpers/retention.helper.js
const moment = require('moment');
const { Op } = require('sequelize');
const Class = require('../models/classes');

async function calculateRetentionRate(teacherId, months = 3, referenceDate = moment.utc(),transaction) {
    // Determine month ranges (oldest → latest)
    const monthRanges = [];

    for (let i = months - 1; i >= 0; i--) {
        monthRanges.push({
            start: moment(referenceDate).subtract(i, 'month').startOf('month').toDate(),
            end: moment(referenceDate).subtract(i, 'month').endOf('month').toDate()
        });
    }

    /**
     * Fetch all classes for teacher in range
     * Single DB call (important)
     */
    const classes = await Class.findAll({
        attributes: ['student_id', 'meeting_start'],
        where: {
            teacher_id: teacherId,
            student_id: { [Op.ne]: null },
            meeting_start: {
                [Op.between]: [monthRanges[0].start, monthRanges[monthRanges.length - 1].end]
            },
            status: {
                [Op.notIn]: ['cancelled']
            }
        },
        raw: true,
        transaction
    });

    if (!classes.length) return 0;

    /**
     * Group students per month
     */
    const studentsPerMonth = monthRanges.map(() => new Set());


    for (const cls of classes) {
        const clsDate = moment(cls.meeting_start);

        monthRanges.forEach((range, idx) => {
            if (clsDate.isBetween(range.start, range.end, null, '[]')) {
                studentsPerMonth[idx].add(cls.student_id);
            }
        });
    }

    const baseMonthStudents = studentsPerMonth[0];

    if (!baseMonthStudents.size) return 0;

    /**
     * Count retained students
     */
    let retainedCount = 0;

    for (const studentId of baseMonthStudents) {
        const presentInAllMonths = studentsPerMonth.every((set) => set.has(studentId));

        if (presentInAllMonths) retainedCount++;
    }

    /**
     * Retention rate %
     */
    const retentionRate = (retainedCount / baseMonthStudents.size) * 100;

    return Math.round(retentionRate);
}

module.exports = { calculateRetentionRate };
