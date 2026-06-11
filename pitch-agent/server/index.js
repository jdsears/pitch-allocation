require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const fixtureRoutes = require('./routes/fixtures');
const allocationRoutes = require('./routes/allocations');
const refereeRoutes = require('./routes/referees');
const generalRoutes = require('./routes/general');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/fixtures', fixtureRoutes);
app.use('/api/allocations', allocationRoutes);
app.use('/api/referees', refereeRoutes);
app.use('/api', generalRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Morley Pitch Agent running on port ${PORT}`);
  // Kick off scheduled fixture scraping (no-op if unconfigured / disabled)
  startScheduler();
});

module.exports = app;
