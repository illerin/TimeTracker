'use strict';

const express = require('express');
const path = require('path');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────
const entriesRouter  = require('./routes/entries');
const projectsRouter = require('./routes/projects');
const exportRouter   = require('./routes/export');

app.use('/api', entriesRouter);
app.use('/api', projectsRouter);
app.use('/api', exportRouter);

// ─── Global Error Handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'An unexpected error occurred.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

/* istanbul ignore next */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Time Tracker running on port ${PORT}`);
  });
}

module.exports = app;
