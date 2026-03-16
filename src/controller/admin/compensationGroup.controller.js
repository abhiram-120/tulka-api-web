const { Op } = require('sequelize');
const ActivityLog = require('../../models/activityLogs');
const CompensationGroup = require('../../models/compensationgroup');
const TeacherSalaryProfile = require('../../models/teacherSalaryProfile');
const TeacherPayslip = require('../../models/TeacherPaySlip');

const normalizeJSONArray = (value) => {
    if (Array.isArray(value)) return value;

    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return [];
        }
    }

    return [];
};

const normalizeJSON = (value) => {
  if (!value) return {};

  if (typeof value === 'object') return value;

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return null;
};

const parseJSONSafe = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return fallback;
};

const toPositiveInt = (value) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const createCompensationGroup = async (req, res) => {
    try {
        const { name, levels, bonus_rules, currency_code, pay_cycle, is_active = true } = req.body;
        const normalizedCurrency = String(currency_code || 'USD').toUpperCase();
        const normalizedPayCycle =
            String(pay_cycle || 'monthly').toLowerCase() === 'half_monthly'
                ? 'half_monthly'
                : 'monthly';

        if (!name || !Array.isArray(levels) || levels.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Name and levels are required'
            });
        }

        // FE sends ONE level at a time
        const incomingLevel = levels[0];

        if (!incomingLevel.key || incomingLevel.hourly_rate == null) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid level data'
            });
        }   

        const levelKey = String(incomingLevel.key).trim();
        const hourlyRate = Number(incomingLevel.hourly_rate);
        if (!levelKey) {
            return res.status(400).json({
                status: 'error',
                message: 'Level key is required'
            });
        }
        if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Hourly rate must be a valid non-negative number'
            });
        }

        const normalizedLevel = {
            key: levelKey,
            hourly_rate: hourlyRate
        };

        // 🔹 Normalize eligible KPIs for this level
        const normalizedEligibleKpis = {
            min_lifetime_lessons: incomingLevel.eligible_kpis?.min_lifetime_lessons ?? 0,
            min_lessons: incomingLevel.eligible_kpis?.min_lessons ?? 0,
            min_hours: incomingLevel.eligible_kpis?.min_hours ?? 0,
            min_retention_rate: incomingLevel.eligible_kpis?.min_retention_rate ?? 0,
            min_working_months: Number(
                incomingLevel.eligible_kpis?.min_working_months ?? 0
            )
        };

        // 🔹 Normalize incoming bonus rules (LEVEL-SCOPED)
        const normalizedIncomingBonuses = Array.isArray(bonus_rules)
            ? bonus_rules.map((rule) => ({
                  level_key: String(rule.level_key).trim(),
                  bonus_name: String(rule.bonus_name || '').trim(),
                  min_lifetime_lessons: rule.min_lifetime_lessons ?? null,
                  min_monthly_hours: rule.min_monthly_hours ?? null,
                  min_retention_rate: rule.min_retention_rate ?? null,
                  bonus_amount: Number(rule.bonus_amount) || 0,
                  is_active: rule.is_active !== false
              }))
            : [];

        let group;

        const existingGroup = await CompensationGroup.findOne({
            where: { name }
        });

        if (existingGroup) {
            const existingLevels = parseJSONSafe(existingGroup.levels, []);
            const existingBonuses = parseJSONSafe(existingGroup.bonus_rules, []);
            const existingEligibleKpis = parseJSONSafe(existingGroup.eligible_kpis, {});
            const beforeSnapshot = {
                levels: existingLevels,
                eligible_kpis: existingEligibleKpis
            };

            // ❌ Prevent duplicate level
            const duplicate = existingLevels.find((lvl) => lvl.key === levelKey);

            if (duplicate) {
                return res.status(400).json({
                    status: 'error',
                    message: `Level "${levelKey}" already exists in group "${existingGroup.name}"`
                });
            }

            group = await existingGroup.update({
                levels: [...existingLevels, normalizedLevel],
                bonus_rules: [...existingBonuses, ...normalizedIncomingBonuses],
                eligible_kpis: {
                    ...existingEligibleKpis,
                    [levelKey]: normalizedEligibleKpis
                },
                ...(pay_cycle ? { pay_cycle: normalizedPayCycle } : {}),
                is_active
            });
            await ActivityLog.create({
                entity_type: 'compensation_group',
                entity_id: group.id,
                action_type: 'compensation_group_level_added',
                performed_by: req.userId ?? null,
                

                before_value: beforeSnapshot,

                after_value: {
                    levels: group.levels,
                    eligible_kpis: group.eligible_kpis,
                    currency_code: currency_code || 'USD',
                    pay_cycle: group.pay_cycle,
                },

                action: {
                    message: `Level ${levelKey} added to compensation group`,
                    level_key: levelKey
                }
            });
        } else {
            group = await CompensationGroup.create({
                name,
                levels: [normalizedLevel],
                bonus_rules: normalizedIncomingBonuses,
                currency_code: normalizedCurrency,
                pay_cycle: normalizedPayCycle,
                eligible_kpis: {
                    [levelKey]: normalizedEligibleKpis
                },
                is_active
            });
        }
        if (!existingGroup) {
            await ActivityLog.create({
                entity_type: 'compensation_group',
                entity_id: group.id,
                action_type: 'compensation_group_created',
                performed_by: req.userId ?? null,
                

                before_value: null,

                after_value: {
                    name: group.name,
                    levels: group.levels,
                    eligible_kpis: group.eligible_kpis,
                    currency_code: currency_code || 'USD',
                    pay_cycle: group.pay_cycle,
                },

                action: {
                    message: 'Compensation group created',
                    level_added: levelKey
                }
            });
        }

        return res.status(200).json({
            status: 'success',
            data: group
        });
    } catch (error) {
        console.error('❌ Create/Update Compensation Group Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to save compensation group'
        });
    }
};

const getCompensationGroups = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const { rows, count } = await CompensationGroup.findAndCountAll({
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    const normalizedGroups = rows.map((group) => {
      const plainGroup = group.get({ plain: true });

      return {
        ...plainGroup,
        levels: normalizeJSONArray(plainGroup.levels),
        bonus_rules: normalizeJSONArray(plainGroup.bonus_rules),
        eligible_kpis: normalizeJSON(plainGroup.eligible_kpis),
      };
    });

    return res.status(200).json({
      status: 'success',
      data: normalizedGroups,
      meta: {
        total: count,
        page,
        limit,
        total_pages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('❌ Get Compensation Groups Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch compensation groups',
    });
  }
};


const updateCompensationGroup = async (req, res) => {
    try {
        const id = toPositiveInt(req.params.id);
        const { levelKey, hourly_rate, bonus_rules, eligible_kpis, currency_code, pay_cycle } = req.body;
        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid compensation group id'
            });
        }

        const payCycleRequested = pay_cycle != null && String(pay_cycle).length > 0;
        const isPayCycleUpdateBlocked =
            payCycleRequested && new Date().getUTCDate() > 15;
        const hasOtherUpdates = !!(levelKey || bonus_rules || eligible_kpis || currency_code);
        if (!hasOtherUpdates && !payCycleRequested) {
            return res.status(400).json({
                status: 'error',
                message: 'Nothing to update'
            });
        }

        if (!hasOtherUpdates && isPayCycleUpdateBlocked) {
            return res.status(400).json({
                status: 'error',
                message: 'Pay cycle cannot be updated after the 15th of the month'
            });
        }

        const group = await CompensationGroup.findByPk(id);
        if (!group) {
            return res.status(404).json({
                status: 'error',
                message: 'Compensation group not found'
            });
        }

        const beforeLevels = normalizeJSONArray(group.levels);
        const beforeBonuses = normalizeJSONArray(group.bonus_rules);
        const beforeEligibility = typeof group.eligible_kpis === 'object' && group.eligible_kpis !== null ? { ...group.eligible_kpis } : {};
        const beforePayCycle = group.pay_cycle;

        const updates = {};
        let normalizedPayCycle = null;

        if (currency_code) {
            updates.currency_code = String(currency_code).toUpperCase();
        }
        if (pay_cycle && !isPayCycleUpdateBlocked) {
            normalizedPayCycle =
                String(pay_cycle).toLowerCase() === 'half_monthly'
                    ? 'half_monthly'
                    : 'monthly';
            updates.pay_cycle = normalizedPayCycle;
        }

        /* -------------------- LEVEL UPDATE -------------------- */
        if (levelKey && hourly_rate != null) {
            const rate = Number(hourly_rate);
            if (Number.isNaN(rate) || rate < 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Hourly rate must be a valid positive number'
                });
            }

            const levels = normalizeJSONArray(group.levels);

            let updated = false;
            const updatedLevels = levels.map((lvl) => {
                if (lvl.key === levelKey) {
                    updated = true;
                    return { ...lvl, hourly_rate: rate };
                }
                return lvl;
            });

            if (!updated) {
                return res.status(404).json({
                    status: 'error',
                    message: `Level "${levelKey}" not found`
                });
            }

            updates.levels = updatedLevels;
        }

        /* -------------------- ELIGIBILITY UPDATE (FIX) -------------------- */
        if (levelKey && eligible_kpis) {
            // 1️⃣ Get raw value from Sequelize
            const rawEligibility = group.getDataValue('eligible_kpis');

            // 2️⃣ Normalize OBJECT safely (string | object | null)
            let dbEligibility = {};

            if (rawEligibility) {
                if (typeof rawEligibility === 'string') {
                    try {
                        dbEligibility = JSON.parse(rawEligibility);
                    } catch (e) {
                        dbEligibility = {};
                    }
                } else if (typeof rawEligibility === 'object') {
                    dbEligibility = { ...rawEligibility };
                }
            }

            // 3️⃣ Normalize incoming KPI values
            const normalizedEligibility = {
                min_lifetime_lessons: Number(eligible_kpis.min_lifetime_lessons) || 0,
                min_lessons: Number(eligible_kpis.min_lessons) || 0,
                min_hours: Number(eligible_kpis.min_hours) || 0,
                min_retention_rate: Number(eligible_kpis.min_retention_rate) || 0,
                min_working_months: Number(eligible_kpis.min_working_months) || 0
            };

            // 4️⃣ Overwrite ONLY this level
            dbEligibility[levelKey] = {
                ...(dbEligibility[levelKey] || {}),
                ...normalizedEligibility
            };

            // 5️⃣ Assign FULL reconstructed object
            updates.eligible_kpis = dbEligibility;
        }

        /* -------------------- BONUS UPDATE -------------------- */
        if (bonus_rules) {
            if (!Array.isArray(bonus_rules)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Bonus rules must be an array'
                });
            }

            const existingBonuses = normalizeJSONArray(group.bonus_rules);
            const updatedBonuses = [...existingBonuses];

            bonus_rules.forEach((incoming) => {
                const key = String(incoming.level_key).trim();
                const index = updatedBonuses.findIndex((b) => b.level_key === key);

                const normalizedBonus = {
                    level_key: key,
                    bonus_name: String(incoming.bonus_name || '').trim(),
                    min_lifetime_lessons: incoming.min_lifetime_lessons ?? null,
                    min_monthly_hours: incoming.min_monthly_hours ?? null,
                    min_retention_rate: incoming.min_retention_rate ?? null,
                    bonus_amount: Number(incoming.bonus_amount) || 0,
                    is_active: incoming.is_active !== false
                };

                if (index !== -1) {
                    updatedBonuses[index] = normalizedBonus;
                } else {
                    updatedBonuses.push(normalizedBonus);
                }
            });

            updates.bonus_rules = updatedBonuses;
        }

        await group.update(updates);

        // Sync teacher pay cycles if group pay cycle changed
        if (normalizedPayCycle) {
            await TeacherSalaryProfile.update(
                { pay_cycle: normalizedPayCycle },
                { where: { compensation_group_id: group.id } }
            );
        }

        if (normalizedPayCycle && normalizedPayCycle !== beforePayCycle) {
            const now = new Date();
            const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
            const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
            const startStr = startOfMonth.toISOString().slice(0, 10);
            const endStr = endOfMonth.toISOString().slice(0, 10);

            const profiles = await TeacherSalaryProfile.findAll({
                where: { compensation_group_id: group.id },
                attributes: ['id']
            });
            const profileIds = profiles.map((p) => p.id);

            if (profileIds.length) {
                if (beforePayCycle === 'monthly' && normalizedPayCycle === 'half_monthly') {
                    const midMonthStr = new Date(Date.UTC(
                        now.getUTCFullYear(),
                        now.getUTCMonth(),
                        15
                    )).toISOString().slice(0, 10);
                    await TeacherPayslip.update(
                        { period_type: 'FIRST_HALF', period_end: midMonthStr },
                        {
                            where: {
                                salary_profile_id: { [Op.in]: profileIds },
                                period_start: { [Op.between]: [startStr, endStr] },
                                period_type: 'FULL'
                            }
                        }
                    );
                } else if (beforePayCycle === 'half_monthly' && normalizedPayCycle === 'monthly') {
                    const endMonthStr = endStr;
                    await TeacherPayslip.update(
                        { period_type: 'FULL', period_end: endMonthStr },
                        {
                            where: {
                                salary_profile_id: { [Op.in]: profileIds },
                                period_start: { [Op.between]: [startStr, endStr] },
                                period_type: 'FIRST_HALF'
                            }
                        }
                    );
                }
            }
        }

        /* -------------------- ACTIVITY LOGGING -------------------- */
        if (updates.eligible_kpis) {
            await ActivityLog.create({
                entity_type: 'compensation_group',
                entity_id: group.id,
                action_type: 'compensation_group_eligibility_updated',
                performed_by: req.userId ?? null,
                before_value: beforeEligibility[levelKey] || null,
                after_value: updates.eligible_kpis[levelKey],
                action: {
                    message: `Eligibility updated for ${levelKey}`,
                    group_name: group.name
                }
            });
        }

        return res.status(200).json({
            status: 'success',
            data: {
                id: group.id,
                name: group.name,
                levels: normalizeJSONArray(group.levels),
                bonus_rules: normalizeJSONArray(group.bonus_rules),
                eligible_kpis: group.eligible_kpis || {},
                currency_code: group.currency_code,
                pay_cycle: group.pay_cycle
            }
        });
    } catch (error) {
        console.error('❌ Update Compensation Group Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update compensation group'
        });
    }
};

const deleteCompensationGroup = async (req, res) => {
    try {
        const id = toPositiveInt(req.params.id);
        const levelKey = String(req.body?.levelKey || '').trim();

        if (!id || !levelKey) {
            return res.status(400).json({
                status: 'error',
                message: 'Group ID and level key are required'
            });
        }

        const group = await CompensationGroup.findByPk(id);

        if (!group) {
            return res.status(404).json({
                status: 'error',
                message: 'Compensation group not found'
            });
        }
        // 🔹 Normalize JSON fields
        const levels = normalizeJSONArray(group.levels);
        const bonusRules = normalizeJSONArray(group.bonus_rules);
        const eligibleKpis = normalizeJSON(group.eligible_kpis) || {};

        if (levels.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No levels found in group'
            });
        }
        const beforeLevels = levels;
        const beforeBonusRules = bonusRules;
        const beforeEligibleKpis = eligibleKpis;

        // 🔍 Check if level exists
        const levelExists = levels.find(lvl => lvl.key === levelKey);
        if (!levelExists) {
            return res.status(404).json({
                status: 'error',
                message: `Level "${levelKey}" not found`
            });
        }

        // 🚨 IMPORTANT: Check if any teacher is using this level
        const activeTeacherCount = await TeacherSalaryProfile.count({
            where: {
                compensation_group_id: group.id,
                current_level: levelKey
            }
        });

        if (activeTeacherCount > 0) {
            return res.status(400).json({
                status: 'error',
                message: `Cannot delete level "${levelKey}". ${activeTeacherCount} teacher(s) are currently assigned to this level.`
            });
        }

        // 🔍 Remove level
        const updatedLevels = levels.filter((lvl) => lvl.key !== levelKey);
        const updatedBonusRules = bonusRules.filter(
            (rule) => String(rule?.level_key || '').trim() !== levelKey
        );
        const updatedEligibleKpis = { ...eligibleKpis };
        delete updatedEligibleKpis[levelKey];

        if (updatedLevels.length === levels.length) {
            return res.status(404).json({
                status: 'error',
                message: `Level "${levelKey}" not found`
            });
        }

        // ✅ HARD DELETE GROUP if no levels left
        if (updatedLevels.length === 0) {
            await group.destroy();

            await ActivityLog.create({
                entity_type: 'compensation_group',
                entity_id: group.id,
                action_type: 'compensation_group_deleted',
                performed_by: req.userId ?? null,

                before_value: {
                    group_name: group.name,
                    levels: beforeLevels
                },

                after_value: null,

                action: {
                    message: 'Compensation group deleted (last level removed)',
                    deleted_level: levelKey
                }
            });

            return res.status(200).json({
                status: 'success',
                message: 'Last level removed. Compensation group deleted.'
            });
        }

        // ✅ Update remaining levels (preserve bonuses)
        await group.update({
            levels: updatedLevels,
            bonus_rules: updatedBonusRules,
            eligible_kpis: updatedEligibleKpis
        });

        await ActivityLog.create({
            entity_type: 'compensation_group',
            entity_id: group.id,
            action_type: 'compensation_group_level_deleted',
            performed_by: req.userId ?? null,

            before_value: {
                levels: beforeLevels,
                bonus_rules: beforeBonusRules,
                eligible_kpis: beforeEligibleKpis
            },

            after_value: {
                levels: updatedLevels,
                bonus_rules: updatedBonusRules,
                eligible_kpis: updatedEligibleKpis
            },

            action: {
                message: `Level ${levelKey} deleted from compensation group`,
                level_key: levelKey
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'Level deleted successfully'
        });
    } catch (error) {
        console.error('❌ Delete Compensation Group Level Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to delete level'
        });
    }
};

module.exports = {
    createCompensationGroup,
    getCompensationGroups,
    updateCompensationGroup,
    deleteCompensationGroup
};
