#!/bin/sh

echo "Rodando script custom..."

psql -U postgres -d chat_db -c "SELECT 'Banco pronto!'"