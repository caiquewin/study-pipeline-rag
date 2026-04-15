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
        console.log("🚀 Criando a tabela de histórico em JSONB (customer)...");

        // Criar a tabela única customer com JSONB
        await client.query(`
            CREATE TABLE IF NOT EXISTS customer (
                client_id TEXT PRIMARY KEY,
                chat_history JSONB NOT NULL DEFAULT '[]'::jsonb,
                attributes JSONB NOT NULL DEFAULT '{}'::jsonb
            );
        `);
        
        console.log("✅ Tabela 'customer' pronta!");

        // Garantir permissões
        await client.query(`
            GRANT ALL PRIVILEGES ON TABLE customer TO ${process.env.PGUSER};
        `);

    } catch (err) {
        console.error("❌ Erro ao inicializar o banco:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

createSimpleSchema();