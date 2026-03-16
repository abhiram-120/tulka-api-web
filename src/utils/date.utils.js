const moment = require('moment-timezone');

function convertToTimezones(dateTimeString, outputTimezone = 'America/New_York') {
    // Parse the input string as UTC
    const utcDateTime = moment.utc(dateTimeString, 'DD/MM/YYYY HH:mm');

    // Convert to output timezone
    const outputTime = utcDateTime.clone().tz(outputTimezone);

    return {
        utc: utcDateTime.format(),
        utcTime: utcDateTime.format('HH:mm'),
        local: outputTime.format(),
        localTime: outputTime.format('HH:mm')
    };
}

function convertToTimezonesV2(dateTimeString, outputTimezone = 'America/New_York') {
    // Parse the input string as UTC
    const utcDateTime = moment(dateTimeString, 'DD/MM/YYYY HH:mm');

    // Convert to output timezone
    const outputTime = utcDateTime.clone().tz(outputTimezone);

    return {
        utc: utcDateTime.format(),
        utcTime: utcDateTime.format('HH:mm'),
        local: outputTime.format(),
        localTime: outputTime.format('HH:mm')
    };
}

function getNext7Days() {
    const dates = [];

    for (let i = 0; i < 35; i++) {
        const currentDate = moment().add(i, 'days');
        const formattedDate = currentDate.format('DD/MM/YYYY');
        const dayName = currentDate.format('ddd').toLowerCase(); // 'dddd' gives the full day name

        dates.push({
            date: formattedDate,
            day: dayName
        });
    }

    return dates;
}

const formatDate = (dateString) => {
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
};

function getLocalDateTime(utcTime, timezone) {
    if (utcTime === null) {
        return null;
    }

    // Create a Moment.js object from the UTC time string
    const utcMoment = moment.utc(utcTime);

    // Set the time zone
    const localMoment = utcMoment.tz(timezone);

    // Format the local time as 'YYYY-MM-DD HH:mm:ss'
    const formattedLocalTime = localMoment.format('YYYY-MM-DD HH:mm:ss');

    return formattedLocalTime;
}

function getLocalDate(timestamp, timezone) {
    // Check if the timestamp is in seconds or milliseconds
    const timestampData = timestamp.length === 13 ? timestamp : timestamp * 1000;

    const date = moment(timestampData);

    // Adjust date to the specified timezone
    date.tz(timezone);

    // Format the date as YYYY-MM-DD HH:mm
    return date.format('YYYY-MM-DD HH:mm');
}

function convertScheduleToUserTimezone(schedule, userTimezone) {
    const convertedSchedule = {};
    for (const day in schedule) {
        convertedSchedule[day] = {};
        for (const time in schedule[day]) {
            const dateTimeUTC = moment.utc(time, 'HH:mm');
            const convertedTime = dateTimeUTC.tz(userTimezone).format('HH:mm');
            convertedSchedule[day][convertedTime] = schedule[day][time];
        }
    }
    return convertedSchedule;
}

module.exports = {
    convertToTimezones,
    getNext7Days,
    getLocalDateTime,
    getLocalDate,
    convertScheduleToUserTimezone,
    convertToTimezonesV2,
    formatDate
};
