import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT
});

async function createSimpleSchema() {
    const client = await pool.connect();
    try {
        console.log("🚀 Criando tabela simples de mensagens...");

        // Criar a tabela sem chaves estrangeiras para evitar erros de dependência
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                client_id TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log("✅ Tabela 'chat_messages' pronta!");

        // Garantir que o usuário tenha acesso
        await client.query(`
            GRANT ALL PRIVILEGES ON TABLE chat_messages TO postgres;
            GRANT ALL PRIVILEGES ON SEQUENCE chat_messages_id_seq TO postgres;
        `);

    } catch (err) {
        console.error("❌ Erro:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

createSimpleSchema();