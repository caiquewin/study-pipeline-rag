import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

export async function initDatabase() {
    try {
        // Inicializa as tabelas se elas não existirem (usando o mesmo padrão do script SQL)
        await pool.query(`CREATE TABLE IF NOT EXISTS clients (client_id TEXT PRIMARY KEY);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(client_id), text TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS chat_history (id SERIAL PRIMARY KEY, client_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        console.log("✅ PostgreSQL: Database initialized.");
    } catch (error) {
        console.error("❌ PostgreSQL: Error initializing database:", error);
    }
}

// Salva o cliente se ele não existir e depois salva a mensagem
export async function saveCustomerMessage(clientId, message) {
    try {
        // 1. Cadastra o cliente se não existir (ON CONFLICT DO NOTHING evita erros)
        await pool.query(`INSERT INTO clients (client_id) VALUES ($1) ON CONFLICT DO NOTHING;`, [clientId]);

        // 2. Salva a conversa
        const query = `INSERT INTO messages (client_id, text) VALUES ($1, $2) RETURNING *;`;
        const res = await pool.query(query, [clientId, message]);
        return res.rows[0];
    } catch (error) {
        console.error("❌ PostgreSQL: Error saving message:", error);
    }
}

// Histórico para a Inteligência Artificial
export async function saveConversation(clientId, question, answer) {
    try {
        await pool.query(`INSERT INTO clients (client_id) VALUES ($1) ON CONFLICT DO NOTHING;`, [clientId]);
        const query = `INSERT INTO chat_history (client_id, question, answer) VALUES ($1, $2, $3) RETURNING *;`;
        const res = await pool.query(query, [clientId, question, answer]);
        return res.rows[0];
    } catch (error) {
        console.error("❌ PostgreSQL: Error saving AI conversation:", error);
    }
}

export default pool;
