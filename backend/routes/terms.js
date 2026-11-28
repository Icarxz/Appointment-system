const express = require('express');
const mongoose = require('mongoose');
const Term = require('../models/Term');
const { requireAuth } = require('../middleware/auth');
const { validateTerm } = require('../utils/termCalendar');

const router = express.Router();
const ALL_ROLES = ['STUDENT', 'FACULTY', 'DEAN', 'ADMIN'];

router.get('/', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const terms = await Term.find().sort({ startDate: 1, academicYear: 1, name: 1 }).lean();
    res.json(terms);
  } catch (error) {
    console.error('Term calendar load failed:', error.message);
    res.status(500).json({ error: 'Could not load the term calendar.' });
  }
});

router.post('/', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const existing = await Term.find().select('name academicYear startDate endDate').lean();
    const validation = validateTerm(req.body || {}, existing);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const term = await Term.create({ ...validation.value, createdBy: req.user.userId });
    res.status(201).json(term);
  } catch (error) {
    console.error('Term creation failed:', error.message);
    res.status(500).json({ error: 'Could not create the term.' });
  }
});

router.put('/:id', requireAuth(['ADMIN']), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid term.' });
    const term = await Term.findById(req.params.id);
    if (!term) return res.status(404).json({ error: 'Term not found.' });

    const existing = await Term.find({ _id: { $ne: term._id } }).select('name academicYear startDate endDate').lean();
    const validation = validateTerm(req.body || {}, existing);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    Object.assign(term, validation.value);
    await term.save();
    res.json(term);
  } catch (error) {
    console.error('Term update failed:', error.message);
    res.status(500).json({ error: 'Could not update the term.' });
  }
});

router.delete('/:id', requireAuth(['ADMIN']), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid term.' });
    const term = await Term.findById(req.params.id);
    if (!term) return res.status(404).json({ error: 'Term not found.' });
    await term.deleteOne();
    res.json({ message: 'Term deleted.' });
  } catch (error) {
    console.error('Term deletion failed:', error.message);
    res.status(500).json({ error: 'Could not delete the term.' });
  }
});

module.exports = router;
