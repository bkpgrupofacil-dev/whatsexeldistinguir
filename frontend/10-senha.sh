#!/bin/sh
# Liga a senha do painel (usuário/senha do navegador) quando APP_USUARIO e APP_SENHA estão definidos.
# A senha fica só dentro do contêiner (vem da variável de ambiente), por isso o formato {PLAIN}.
set -e
if [ -n "$APP_USUARIO" ] && [ -n "$APP_SENHA" ]; then
  printf '%s:%s\n' "$APP_USUARIO" "{PLAIN}$APP_SENHA" > /etc/nginx/.htpasswd
  printf 'auth_basic "WhatsApp Distinguir";\nauth_basic_user_file /etc/nginx/.htpasswd;\n' > /etc/nginx/auth.conf
  echo "Senha do painel ativada para o usuário $APP_USUARIO"
else
  : > /etc/nginx/auth.conf
  echo "AVISO: APP_USUARIO/APP_SENHA não definidos, painel SEM senha"
fi
