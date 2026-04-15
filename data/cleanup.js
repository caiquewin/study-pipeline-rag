import pg from 'pg';
import neo4j from 'neo4j-driver';

// Configurações do PostgreSQL
const pool = new pg.Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT
});

// Configurações do Neo4j
const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

async function cleanup() {
    console.log("🧹 Iniciando limpeza dos bancos de dados...");

    // 1. Limpeza do PostgreSQL
    try {
        const pgClient = await pool.connect();
        console.log("🐘 PostgreSQL: Removendo tabela 'customer'...");
        await pgClient.query('DROP TABLE IF EXISTS customer;');
        pgClient.release();
        console.log("✅ PostgreSQL: Limpo com sucesso!");
    } catch (err) {
        console.error("❌ Erro ao limpar PostgreSQL:", err.message);
    }

    // 2. Limpeza do Neo4j
    const session = driver.session();
    try {
        console.log("🕸️ Neo4j: Removendo todos os nós e relacionamentos...");
        await session.run('MATCH (n) DETACH DELETE n');
        console.log("✅ Neo4j: Limpo com sucesso!");
    } catch (err) {
        console.error("❌ Erro ao limpar Neo4j:", err.message);
    } finally {
        await session.close();
    }

    // Fechar conexões
    await pool.end();
    await driver.close();
    console.log("\n✨ Limpeza concluída!");
    process.exit(0);
}

cleanup();