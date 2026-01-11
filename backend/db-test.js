// db.js
const { Pool } = require('pg');

// Pool erstellen (Verbindung zur DB)
const pool = new Pool({
  host: process.env.POSTGRES_HOST || "192.168.72.2",
  port: 5432,
  user: process.env.POSTGRES_USER || "pgadmin",
  password: process.env.POSTGRES_PASSWORD || "hsG3ZLJYz1a181",
  database: process.env.POSTGRES_DB || "fahrtenbuch",
});

// Funktion, um Daten abzufragen
async function getUsers() {
  try {
    const result = await pool.query('SELECT id, name, email FROM users');
    console.log(result.rows); // Ergebnis als Array von Objekten
  } catch (err) {
    console.error('Fehler bei der Abfrage', err);
  } finally {
    await pool.end(); // Verbindung sauber schließen
  }
}

// Aufruf der Funktion
getUsers();