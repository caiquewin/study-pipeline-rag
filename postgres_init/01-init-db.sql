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
SELECT current_database();

-- 3. Criar tabela única customer usando JSONB (Melhor prática)
CREATE TABLE IF NOT EXISTS public.customer (
    client_id TEXT PRIMARY KEY,
    chat_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 4. Permissões
GRANT ALL PRIVILEGES ON TABLE public.customer TO app_user;