import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    user:     process.env.PGUSER,
    host:     process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port:     process.env.PGPORT,
})

export async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS customer (
                client_id    TEXT    PRIMARY KEY,
                chat_history JSONB   NOT NULL DEFAULT '[]'::jsonb,
                attributes   JSONB   NOT NULL DEFAULT '{}'::jsonb
            );
        `)
        console.log('✅ PostgreSQL: customer table ready.')
    } catch (error) {
        console.error('❌ PostgreSQL: Error initializing database:', error)
    }
}

export async function saveConversation(clientId, question, answer, attributes = {}) {
    try {
        const userMsg = { author: clientId, body: question, date_created: new Date().toISOString() }
        const botMsg  = { author: 'bot',    body: answer,   date_created: new Date().toISOString() }

        const res = await pool.query(`
            INSERT INTO customer (client_id, chat_history, attributes)
            VALUES ($1, jsonb_build_array($2::jsonb, $3::jsonb), $4::jsonb)
            ON CONFLICT (client_id) DO UPDATE SET
                chat_history = customer.chat_history || jsonb_build_array($2::jsonb, $3::jsonb),
                attributes   = customer.attributes   || $4::jsonb
            RETURNING *;
        `, [clientId, JSON.stringify(userMsg), JSON.stringify(botMsg), JSON.stringify(attributes)])

        return res.rows[0]
    } catch (error) {
        console.error('❌ PostgreSQL: Error saving conversation:', error)
    }
}

export async function getCustomer(clientId) {
    try {
        const res = await pool.query('SELECT * FROM customer WHERE client_id = $1;', [clientId])
        return res.rows[0]
    } catch (error) {
        console.error('❌ PostgreSQL: Error getting customer:', error)
    }
}

export default pool
