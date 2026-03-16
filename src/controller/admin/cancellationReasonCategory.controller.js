const { Op } = require("sequelize");
const CancellationReasonCategory = require("../../models/cancellationReasonCategory");

/**
 * 🟢 GET all cancellation reason categories
 * Used by admin panel and user cancel dropdown
 */
const getAllCancellationCategories = async (req, res) => {
  try {
    const categories = await CancellationReasonCategory.findAll({
      attributes: ["id", "name", "description", "status", "created_at", "updated_at"],
      where: {
        status: { [Op.ne]: "inactive" }, // optional filter — only show active categories
      },
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({
      status: "success",
      data: categories,
      message: "Cancellation categories fetched successfully",
    });
  } catch (error) {
    console.error("❌ Error fetching categories:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to fetch cancellation categories",
      details: error.message,
    });
  }
};

/**
 * 🟡 CREATE a new cancellation reason category
 * Admin adds a new reason (e.g., “Teacher Issue”, “Financial Reasons”, etc.)
 */
const createCancellationCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({
        status: "error",
        message: "Name is required to create a category",
      });
    }

    // check if reason name already exists
    const existing = await CancellationReasonCategory.findOne({
      where: { name: { [Op.eq]: name.trim() } },
    });

    if (existing) {
      return res.status(400).json({
        status: "error",
        message: "Cancellation reason already exists",
      });
    }

    await CancellationReasonCategory.create({
      name: name.trim(),
      description: description || null,
    });

    return res.status(201).json({
      status: "success",
      message: "Cancellation reason category created successfully",
    });
  } catch (error) {
    console.error("❌ Error creating category:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to create cancellation category",
      details: error.message,
    });
  }
};

/**
 * 🟠 UPDATE an existing cancellation reason category
 * Admin can rename or mark it as inactive
 */
const updateCancellationCategory = async (req, res) => {
  try {
    const { id, name, description, status } = req.body;

    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "Category ID is required to update",
      });
    }

    const category = await CancellationReasonCategory.findByPk(id);
    if (!category) {
      return res.status(404).json({
        status: "error",
        message: "Cancellation reason category not found",
      });
    }

    await category.update({
      name: name ? name.trim() : category.name,
      description: description ?? category.description,
      status: status ?? category.status,
    });

    return res.status(200).json({
      status: "success",
      message: "Cancellation reason category updated successfully",
    });
  } catch (error) {
    console.error("❌ Error updating category:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to update cancellation category",
      details: error.message,
    });
  }
};

/**
 * 🔴 DELETE a cancellation reason category
 * Only deletes from list; subscriptions referencing it will retain their data (thanks to SET NULL)
 */
const deleteCancellationCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "Category ID is required for deletion",
      });
    }

    console.log('id',id);

    const category = await CancellationReasonCategory.findByPk(id);
    console.log('category',category);
    if (!category) {
      return res.status(404).json({
        status: "error",
        message: "Cancellation reason category not found",
      });
    }

    await category.destroy();

    return res.status(200).json({
      status: "success",
      message: "Cancellation reason category deleted successfully",
    });
  } catch (error) {
    console.error("❌ Error deleting category:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to delete cancellation category",
      details: error.message,
    });
  }
};

module.exports = {
  getAllCancellationCategories,
  createCancellationCategory,
  updateCancellationCategory,
  deleteCancellationCategory,
};
