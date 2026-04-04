# # Use uma versão leve do Node.js
# FROM node:22-alpine

# # Define o diretório de trabalho dentro do container
# WORKDIR /app

# # Copia apenas os arquivos de dependências primeiro (otimiza o cache do Docker)
# COPY package*.json ./

# # Instala as dependências de produção
# RUN npm ci --omit=dev

# # Copia o restante do código da aplicação
# COPY . .

# # Expõe a porta que a aplicação usa
# EXPOSE 3002

# # Comando para iniciar a aplicação
# # Note que usamos --env-file .env para carregar as variáveis no Docker
# CMD ["node", "--env-file", ".env", "src/index.js"]
