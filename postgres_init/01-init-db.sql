-- 1. Criar usuário
DO $$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user'
   ) THEN
      CREATE ROLE app_user WITH LOGIN PASSWORD 'sua_senha_segura';
   END IF;
END $$;

-- 2. Garantir conexão no banco correto
-- (isso aqui resolve MUITO bug escondido)
SELECT current_database();

-- 3. Criar tabela clients
CREATE TABLE IF NOT EXISTS public.clients (
    client_id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

-- 4. Criar tabela messages
CREATE TABLE IF NOT EXISTS public.messages (
    id SERIAL PRIMARY KEY,
    client_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_client
        FOREIGN KEY (client_id)
        REFERENCES public.clients(client_id)
        ON DELETE CASCADE
);

-- 5. Permissões
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;