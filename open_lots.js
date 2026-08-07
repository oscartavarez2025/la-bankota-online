require('dotenv').config();
const { pool } = require('./db');
(async () => {
  try {
    await pool.query("UPDATE sorteos SET hora = '23:59:00', hora_cierre = '23:59:00'");
    console.log('DB updated successfully');
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
})();
