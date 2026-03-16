const express = require('express');
const router = express.Router();
const questionBankController = require('../../controller/admin/question-bank.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureQuestionBankAccess = checkPermission('question-bank', 'read');
const ensureQuestionBankCreate = checkPermission('question-bank', 'create');
const ensureQuestionBankUpdate = checkPermission('question-bank', 'update');
const ensureQuestionBankDelete = checkPermission('question-bank', 'delete');

router.get('/list', AuthValidator, ensureQuestionBankAccess, questionBankController.getQuestions);
router.get('/:id', AuthValidator, ensureQuestionBankAccess, questionBankController.getQuestionById);

router.post('/', 
    AuthValidator, 
    ensureQuestionBankCreate,
    questionBankController.uploadImages.fields([
        { name: 'optionImages', maxCount: 10 }
    ]),
    questionBankController.createQuestion
);

router.put('/:id', 
    AuthValidator, 
    ensureQuestionBankUpdate,
    questionBankController.uploadImages.fields([
        { name: 'optionImages', maxCount: 10 }
    ]),
    questionBankController.updateQuestion
);

router.patch('/update-order', AuthValidator, ensureQuestionBankUpdate, questionBankController.updateQuestionOrder);
router.delete('/:id', AuthValidator, ensureQuestionBankDelete, questionBankController.deleteQuestion);
router.patch('/:id/toggle-status', AuthValidator, ensureQuestionBankUpdate, questionBankController.toggleQuestionStatus);

module.exports = router;