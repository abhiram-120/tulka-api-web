// utils/studentLevels.js

const studentLevels = {
    1: 'Pre basic 1',
    2: 'Basic user A1',
    3: 'High basic user A1',
    4: 'Low basic user A2',
    5: 'Basic user A2',
    6: 'High basic user A2',
    7: 'Low independent user B1',
    8: 'Independent user B1',
    9: 'High independent user B1',
    10: 'Low independent user B2',
    11: 'Independent user B2',
    12: 'High independent user B2',
    13: 'Advanced C1',
    14: 'Superior Advanced C1',
    15: 'Highly Advanced C1'
};

const getStudentLevel = (id) => {
    return studentLevels[id] || null;
};

module.exports = { getStudentLevel ,studentLevels};