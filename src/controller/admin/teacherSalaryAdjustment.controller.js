const TeacherSalaryAdjustment = require("../../models/TeacherSalaryAdjustments");
const Class = require("../../models/classes");
const TrialClassRegistration = require("../../models/trialClassRegistration");
const User = require("../../models/users");

const parseJsonObject = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;

  if (typeof value === "string") {
    try {
      let parsed = JSON.parse(value);
      while (typeof parsed === "string") {
        parsed = JSON.parse(parsed);
      }
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
};

const getTeacherSalaryAdjustments = async (req, res) => {
  try {
    const { teacher_id } = req.params;

    if (!teacher_id) {
      return res.status(400).json({
        status: 'error',
        message: 'teacher_id is required',
      });
    }

    const adjustments = await TeacherSalaryAdjustment.findAll({
      where: { teacher_id },
      order: [['applied_date', 'DESC']],
    });

    const normalizedAdjustments = adjustments.map((adj) => ({
      adj,
      value: parseJsonObject(adj.value, {}),
    }));

    const regularClassIds = new Set();
    const trialClassIds = new Set();

    normalizedAdjustments.forEach(({ adj, value }) => {
      if (adj.type !== 'penalty') return;

      (value?.regular_class_ids || []).forEach((id) =>
        regularClassIds.add(Number(id))
      );
      (value?.trial_class_ids || []).forEach((id) =>
        trialClassIds.add(Number(id))
      );
    });

    const regularClassMap = {};
    if (regularClassIds.size) {
      const regularClasses = await Class.findAll({
        where: { id: [...regularClassIds] },
        include: [
          {
            model: User,
            as: 'Student',
            attributes: ['id', ['full_name', 'name']],
          },
        ],
      });

      regularClasses.forEach((cls) => {
        const duration =
          cls.meeting_start && cls.meeting_end
            ? Math.round(
                (new Date(cls.meeting_end) - new Date(cls.meeting_start)) /
                  60000
              )
            : 0;

        regularClassMap[cls.id] = {
          student_name: cls.Student?.dataValues?.name ?? null,
          meeting_start: cls.meeting_start,
          meeting_end: cls.meeting_end,
          class_date: cls.meeting_start,
          is_present: cls.is_present,
          duration,
          type: 'regular',
        };
      });
    }

    const trialClassMap = {};
    if (trialClassIds.size) {
      const trialWrapperClasses = await Class.findAll({
        where: { id: [...trialClassIds] },
        attributes: ['id', 'demo_class_id'],
        raw: true,
      });

      const demoClassIds = trialWrapperClasses
        .map((c) => c.demo_class_id)
        .filter(Boolean);

      if (demoClassIds.length) {
        const trialRegistrations = await TrialClassRegistration.findAll({
          where: { id: demoClassIds },
        });

        const trialRegistrationMap = {};
        trialRegistrations.forEach((trial) => {
          const duration =
            trial.meeting_start && trial.meeting_end
              ? Math.round(
                  (new Date(trial.meeting_end) - new Date(trial.meeting_start)) /
                    60000
                )
              : 0;

          trialRegistrationMap[trial.id] = {
            student_name: trial.student_name,
            meeting_start: trial.meeting_start,
            meeting_end: trial.meeting_end,
            class_date: trial.meeting_start,
            is_present: trial.status === 'completed',
            duration,
            type: 'trial',
          };
        });

        trialWrapperClasses.forEach((wrapper) => {
          if (!wrapper.demo_class_id) return;
          const details = trialRegistrationMap[wrapper.demo_class_id];
          if (details) {
            trialClassMap[wrapper.id] = details;
          }
        });
      }
    }

    const bonuses = [];
    const penalties = [];

    for (const { adj, value } of normalizedAdjustments) {
      const classDetails = [];

      if (adj.type === 'penalty') {
        (value?.regular_class_ids || []).forEach((id) => {
          if (regularClassMap[id]) classDetails.push(regularClassMap[id]);
        });

        (value?.trial_class_ids || []).forEach((id) => {
          if (trialClassMap[id]) classDetails.push(trialClassMap[id]);
        });
      }

      const payload = {
        id: adj.id,
        teacher_id: adj.teacher_id,
        applied_date: adj.applied_date,
        value,
        is_bonus: adj.type === 'bonus',
        is_penalty: adj.type === 'penalty',
        created_at: adj.created_at,
        ...(classDetails.length ? { class_details: classDetails } : {}),
      };

      if (adj.type === 'bonus') {
        bonuses.push(payload);
      } else if (adj.type === 'penalty') {
        penalties.push(payload);
      }
    }

    return res.status(200).json({
      status: 'success',
      data: {
        bonuses,
        penalties,
      },
    });
  } catch (error) {
    console.error('Get Teacher Salary Adjustments Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch salary adjustments',
    });
  }
};

module.exports={getTeacherSalaryAdjustments}
